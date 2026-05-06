import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    DeleteVideoTimestampFeature,
    DeleteVideoTimestampFeatureResponse,
} from './delete-video-timestamp.feature'

@Feature(DeleteVideoTimestampFeature)
export class DeleteVideoTimestampHandler
    implements
        IFeatureHandler<
            DeleteVideoTimestampFeature,
            DeleteVideoTimestampFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({
        workspaceId,
        videoId,
        timestampId,
    }: DeleteVideoTimestampFeature) {
        // deleteMany silently no-ops on a missing row, which lets the same
        // call be safely retried after a network blip without bubbling up
        // a P2025. Workspace + videoId in the WHERE keeps a malicious
        // client from deleting timestamps in other workspaces.
        await this.prisma.videoTimestamp.deleteMany({
            where: {
                id: timestampId,
                videoId,
                video: { workspaceId },
            },
        })
        return { status: 'deleted' as const }
    }
}
