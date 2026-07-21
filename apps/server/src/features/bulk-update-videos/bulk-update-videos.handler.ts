import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { VideoService } from '../../domains/video/services/video.service'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import {
    BulkUpdateVideosFeature,
    BulkUpdateVideosFeatureResponse,
} from './bulk-update-videos.feature'

@Feature(BulkUpdateVideosFeature)
export class BulkUpdateVideosHandler
    implements
        IFeatureHandler<
            BulkUpdateVideosFeature,
            BulkUpdateVideosFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly videoService: VideoService,
        private readonly audit: AuditService,
    ) {}

    async execute({ payload, invokerUserId }: BulkUpdateVideosFeature) {
        const { workspaceId, videoIds, action, categoryId } = payload

        // Only touch videos that actually belong to this workspace — a caller
        // can't reach into another club's library by listing foreign ids.
        const owned = await this.prisma.video.findMany({
            where: { id: { in: videoIds }, workspaceId },
            select: { id: true },
        })
        const ids = owned.map((v) => v.id)
        if (ids.length === 0) return { affected: 0 }

        let affected = 0

        if (action === 'setPublic' || action === 'setPrivate') {
            const res = await this.prisma.video.updateMany({
                where: { id: { in: ids }, workspaceId },
                data: { isPublic: action === 'setPublic' },
            })
            affected = res.count
        } else if (action === 'addCategory' || action === 'removeCategory') {
            if (!categoryId) {
                throw new BadRequestError({
                    message: 'categoryId is required for this action',
                })
            }
            const category = await this.prisma.category.findFirst({
                where: { id: categoryId, workspaceId },
                select: { id: true },
            })
            if (!category) {
                throw new BadRequestError({ message: 'Категория не найдена' })
            }
            if (action === 'addCategory') {
                const res = await this.prisma.videoCategory.createMany({
                    data: ids.map((videoId) => ({ videoId, categoryId })),
                    skipDuplicates: true,
                })
                affected = res.count
            } else {
                const res = await this.prisma.videoCategory.deleteMany({
                    where: { categoryId, videoId: { in: ids } },
                })
                affected = res.count
            }
        } else {
            // delete — reuse the single-video path so storage + relations are
            // cleaned up exactly as they are for a one-off delete.
            for (const id of ids) {
                await this.videoService.deleteVideo({
                    videoId: id,
                    workspaceId,
                })
                affected++
            }
        }

        await this.audit.record({
            action: 'video.bulkUpdate',
            targetType: 'video',
            targetId: null,
            workspaceId,
            actorId: invokerUserId,
            metadata: {
                action,
                count: affected,
                ...(categoryId ? { categoryId } : {}),
            },
        })

        return { affected }
    }
}
