import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
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
            select: { id: true },
        })
        if (!video) throw new NotFoundError({ message: 'Video not found' })

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
