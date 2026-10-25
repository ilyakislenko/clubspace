import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    ListMyFavoritesFeature,
    ListMyFavoritesFeatureResponse,
} from './list-my-favorites.feature'

@Feature(ListMyFavoritesFeature)
export class ListMyFavoritesHandler
    implements
        IFeatureHandler<
            ListMyFavoritesFeature,
            ListMyFavoritesFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ userId, workspaceId }: ListMyFavoritesFeature) {
        // The app syncs favorites on every refresh, so a club with videos off
        // gets an empty list, not a 403 that would loop the refresh.
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { videosEnabled: true },
        })
        if (workspace?.videosEnabled === false) return { data: [] }

        const rows = await this.prisma.videoFavorite.findMany({
            where: { userId, workspaceId },
            orderBy: { createdAt: 'desc' },
            include: {
                video: {
                    select: {
                        id: true,
                        title: true,
                        duration: true,
                        thumbnailUrl: true,
                        status: true,
                    },
                },
            },
        })

        return {
            data: rows.map((row) => ({
                videoId: row.videoId,
                createdAt: row.createdAt.toISOString(),
                video: row.video
                    ? {
                          id: row.video.id,
                          title: row.video.title,
                          duration: row.video.duration,
                          thumbnailUrl: row.video.thumbnailUrl,
                          status: row.video.status,
                      }
                    : null,
            })),
        }
    }
}
