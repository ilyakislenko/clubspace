import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    SaveVideoProgressFeature,
    SaveVideoProgressFeatureResponse,
} from './save-video-progress.feature'

const COMPLETION_RATIO = 0.9

@Feature(SaveVideoProgressFeature)
export class SaveVideoProgressHandler
    implements
        IFeatureHandler<
            SaveVideoProgressFeature,
            SaveVideoProgressFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({
        userId,
        videoId,
        payload,
    }: SaveVideoProgressFeature) {
        const video = await this.prisma.video.findUnique({
            where: { id: videoId },
            select: { id: true, workspaceId: true, duration: true },
        })

        if (!video) {
            throw new NotFoundError({ message: 'Video not found' })
        }

        const position = Math.max(0, payload.position ?? 0)
        const autoCompleted =
            !!video.duration &&
            video.duration > 0 &&
            position / video.duration >= COMPLETION_RATIO
        const completed = payload.completed ?? autoCompleted

        const now = new Date()

        const record = await this.prisma.videoWatched.upsert({
            where: { userId_videoId: { userId, videoId } },
            create: {
                userId,
                videoId,
                workspaceId: video.workspaceId,
                position,
                completed,
                watchedAt: now,
            },
            update: {
                position,
                completed,
                watchedAt: now,
            },
        })

        return {
            videoId,
            position: record.position,
            completed: record.completed,
            watchedAt: record.watchedAt.toISOString(),
        }
    }
}
