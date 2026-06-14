import { Feature, IFeatureHandler } from '@shelfjs/features'

import { assertActiveWorkspaceMembership } from '../../shared/access/assert-membership'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    SetVideoFavoriteFeature,
    SetVideoFavoriteFeatureResponse,
} from './set-video-favorite.feature'

@Feature(SetVideoFavoriteFeature)
export class SetVideoFavoriteHandler
    implements
        IFeatureHandler<
            SetVideoFavoriteFeature,
            SetVideoFavoriteFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ userId, videoId, payload }: SetVideoFavoriteFeature) {
        const video = await this.prisma.video.findUnique({
            where: { id: videoId },
            select: { id: true, workspaceId: true },
        })

        if (!video) {
            throw new NotFoundError({ message: 'Video not found' })
        }

        // Gate by membership so a member of one workspace can't favorite (or
        // probe the existence of) another workspace's videos by id.
        await assertActiveWorkspaceMembership(
            this.prisma,
            userId,
            video.workspaceId,
        )

        if (payload.favorite) {
            // Idempotent: re-favoriting an already-favorite video is a no-op
            // and we do NOT bump createdAt — sort order should be "first
            // starred" not "last touched".
            await this.prisma.videoFavorite.upsert({
                where: { userId_videoId: { userId, videoId } },
                create: {
                    userId,
                    videoId,
                    workspaceId: video.workspaceId,
                },
                update: {},
            })
        } else {
            await this.prisma.videoFavorite.deleteMany({
                where: { userId, videoId },
            })
        }

        return { videoId, favorite: payload.favorite }
    }
}
