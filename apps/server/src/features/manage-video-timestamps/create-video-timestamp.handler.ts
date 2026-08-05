import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import {
    CreateVideoTimestampFeature,
    VideoTimestampResponse,
} from './create-video-timestamp.feature'

@Feature(CreateVideoTimestampFeature)
export class CreateVideoTimestampHandler
    implements
        IFeatureHandler<CreateVideoTimestampFeature, VideoTimestampResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({
        payload,
        workspaceId,
        videoId,
    }: CreateVideoTimestampFeature) {
        const video = await this.prisma.video.findFirst({
            where: { id: videoId, workspaceId },
            select: { id: true, duration: true },
        })
        if (!video) throw new NotFoundError({ message: 'Видео не найдено' })

        // Cap at the known duration when we have it. Old uploads might be
        // missing duration (back-filled lazily by the player), so when it's
        // null we let any non-negative position through and accept the
        // tradeoff of one stray "345142:48:44" until the duration lands.
        if (
            video.duration !== null &&
            video.duration > 0 &&
            payload.positionSec > video.duration
        ) {
            throw new BadRequestError({
                message: `Время за пределами видео (${video.duration} сек).`,
            })
        }

        const created = await this.prisma.videoTimestamp.create({
            data: {
                videoId,
                positionSec: payload.positionSec,
                title: payload.title.trim(),
            },
        })

        return {
            id: created.id,
            positionSec: created.positionSec,
            title: created.title,
        }
    }
}
