import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { VideoTextProducer } from '../../domains/video/services/video-text.producer'
import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    ConflictError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { isSubtitleKey } from '../../shared/utils/storage-keys'
import { reindexChapterMentions } from '../techniques/chapter-mentions'
import {
    RegenerateVideoTextFeature,
    type RegenerateVideoTextFeatureResponse,
} from './video-text.feature'
import { AUTO_CHAPTER_SOURCES } from './video-text-sources'

/**
 * «Пересоздать главы/субтитры»: removes what the worker made — never what
 * staff made — and queues the worker to make it again from the stored
 * transcript. Chapters only while the video has no manual chapters (the worker
 * never mixes its chapters with a coach's).
 */
@Feature(RegenerateVideoTextFeature)
export class RegenerateVideoTextHandler
    implements IFeatureHandler<RegenerateVideoTextFeature, RegenerateVideoTextFeatureResponse>
{
    private readonly logger = new Logger(RegenerateVideoTextHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly producer: VideoTextProducer,
        private readonly files: FilesService,
        private readonly audit: AuditService,
    ) {}

    async execute({ workspaceId, videoId, payload, invokerUserId }: RegenerateVideoTextFeature) {
        const video = await this.prisma.video.findFirst({
            where: { id: videoId, workspaceId },
            select: { status: true, timestamps: { select: { source: true } } },
        })
        if (!video) throw new NotFoundError({ message: 'Видео не найдено' })
        if (video.status !== 'ready') {
            throw new BadRequestError({ message: 'Видео ещё не готово — дождитесь обработки.' })
        }
        if (
            payload.chapters &&
            video.timestamps.some((t) => !AUTO_CHAPTER_SOURCES.includes(t.source))
        ) {
            throw new ConflictError({
                message:
                    'У видео есть главы, добавленные вручную. Удалите их, чтобы главы сделались автоматически.',
            })
        }
        if (await this.producer.regenerationState(videoId)) {
            throw new ConflictError({ message: 'Главы и субтитры этого видео уже пересоздаются.' })
        }

        let chaptersRemoved = 0
        if (payload.chapters) {
            const [removed] = await this.prisma.$transaction([
                this.prisma.videoTimestamp.deleteMany({
                    where: { videoId, source: { in: AUTO_CHAPTER_SOURCES } },
                }),
                // Unstamped, so the job scans for chapters again.
                this.prisma.video.update({
                    where: { id: videoId },
                    data: { chaptersScannedAt: null },
                }),
            ])
            chaptersRemoved = removed.count
            await reindexChapterMentions(this.prisma, videoId)
        }

        let subtitlesRemoved = 0
        if (payload.subtitles) {
            const auto = await this.prisma.videoSubtitle.findMany({
                where: { videoId, source: 'auto' },
                select: { id: true, storageKey: true },
            })
            const removed = await this.prisma.videoSubtitle.deleteMany({
                where: { id: { in: auto.map((s) => s.id) }, source: 'auto' },
            })
            subtitlesRemoved = removed.count
            const bucket = this.files.getDefaultBucketName()
            for (const s of auto) {
                if (!isSubtitleKey(s.storageKey, videoId)) continue
                // A leftover file is harmless; the rows are what players read.
                await this.files.deleteObject({ bucket, key: s.storageKey }).catch((e: unknown) => {
                    this.logger.warn(`could not delete ${s.storageKey}: ${String(e)}`)
                })
            }
        }

        await this.producer.enqueueRegeneration(videoId)
        await this.audit.record({
            action: 'video.regenerateText',
            targetType: 'video',
            targetId: videoId,
            workspaceId,
            actorId: invokerUserId,
            metadata: { ...payload, chaptersRemoved, subtitlesRemoved },
        })
        return { status: 'queued' as const, chaptersRemoved, subtitlesRemoved }
    }
}

