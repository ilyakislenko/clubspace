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
