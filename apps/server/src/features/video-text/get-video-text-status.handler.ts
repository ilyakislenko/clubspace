import { Feature, IFeatureHandler } from '@shelfjs/features'

import { VideoTextProducer } from '../../domains/video/services/video-text.producer'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    GetVideoTextStatusFeature,
    type GetVideoTextStatusFeatureResponse,
} from './video-text.feature'
import { AUTO_CHAPTER_SOURCES, countSources } from './video-text-sources'

@Feature(GetVideoTextStatusFeature)
export class GetVideoTextStatusHandler
    implements IFeatureHandler<GetVideoTextStatusFeature, GetVideoTextStatusFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly producer: VideoTextProducer,
    ) {}

    async execute({ workspaceId, videoId }: GetVideoTextStatusFeature) {
        const video = await this.prisma.video.findFirst({
            where: { id: videoId, workspaceId },
            select: {
                status: true,
                chaptersScannedAt: true,
                transcript: {
                    select: { language: true, segments: true, translations: true, updatedAt: true },
                },
                timestamps: { select: { source: true } },
                subtitles: { select: { source: true } },
            },
        })
        if (!video) throw new NotFoundError({ message: 'Видео не найдено' })
        const t = video.transcript
        const ru =
            t?.translations && typeof t.translations === 'object' && 'ru' in t.translations
                ? t.translations.ru
                : null
        return {
            videoStatus: video.status,
            chaptersScannedAt: video.chaptersScannedAt?.toISOString() ?? null,
            transcript: t
                ? {
                      language: t.language,
                      segmentCount: Array.isArray(t.segments) ? t.segments.length : 0,
                      translatedRu: Array.isArray(ru) && ru.length > 0,
                      updatedAt: t.updatedAt.toISOString(),
                  }
                : null,
            chapters: countSources(video.timestamps, (s) => !AUTO_CHAPTER_SOURCES.includes(s)),
            subtitles: countSources(video.subtitles, (s) => s !== 'auto'),
            regeneration: await this.producer.regenerationState(videoId),
        }
    }
}

