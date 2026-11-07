import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    ListMyVideoBookmarksFeature,
    ListMyVideoBookmarksFeatureResponse,
} from './list-my-video-bookmarks.feature'
import { loadVideoForStudent, serializeMyVideoBookmark } from './schemas'

@Feature(ListMyVideoBookmarksFeature)
export class ListMyVideoBookmarksHandler
    implements
        IFeatureHandler<
            ListMyVideoBookmarksFeature,
            ListMyVideoBookmarksFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ userId, videoId }: ListMyVideoBookmarksFeature) {
        await loadVideoForStudent(this.prisma, userId, videoId)
        const rows = await this.prisma.videoBookmark.findMany({
            where: { userId, videoId, deletedAt: null },
            orderBy: [{ positionSec: 'asc' }, { createdAt: 'asc' }],
        })
        return { items: rows.map(serializeMyVideoBookmark) }
    }
}
