import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import {
    UpdateVideoTimestampFeature,
    type VideoTimestampResponse,
} from './update-video-timestamp.feature'

@Feature(UpdateVideoTimestampFeature)
export class UpdateVideoTimestampHandler
    implements
        IFeatureHandler<UpdateVideoTimestampFeature, VideoTimestampResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({
        payload,
        workspaceId,
        videoId,
        timestampId,
    }: UpdateVideoTimestampFeature) {
        const existing = await this.prisma.videoTimestamp.findFirst({
            where: {
                id: timestampId,
                videoId,
                video: { workspaceId },
            },
            select: { id: true, video: { select: { duration: true } } },
        })
        if (!existing) {
            throw new NotFoundError({ message: 'Timestamp not found' })
        }

        if (
            payload.positionSec !== undefined &&
            existing.video.duration !== null &&
            existing.video.duration > 0 &&
            payload.positionSec > existing.video.duration
        ) {
            throw new BadRequestError({
                message: `Время за пределами видео (${existing.video.duration} сек).`,
            })
        }

        const updated = await this.prisma.videoTimestamp.update({
            where: { id: timestampId },
            data: {
                ...(payload.positionSec !== undefined && {
                    positionSec: payload.positionSec,
                }),
                ...(payload.title !== undefined && {
                    title: payload.title.trim(),
                }),
            },
        })

        return {
            id: updated.id,
            positionSec: updated.positionSec,
            title: updated.title,
        }
    }
}
