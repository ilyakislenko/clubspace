import { Feature, IFeatureHandler } from '@shelfjs/features'

import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertActiveWorkspaceMembership } from '../../shared/access/assert-membership'
import {
    ListMyVideoReviewsFeature,
    ListMyVideoReviewsFeatureResponse,
} from './list-my-video-reviews.feature'
import { reviewSummaryInclude, serializeReviewSummary } from './schemas'

@Feature(ListMyVideoReviewsFeature)
export class ListMyVideoReviewsHandler
    implements IFeatureHandler<ListMyVideoReviewsFeature, ListMyVideoReviewsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly files: FilesService,
    ) {}

    async execute({
        userId,
        workspaceId,
    }: ListMyVideoReviewsFeature): Promise<ListMyVideoReviewsFeatureResponse> {
        await assertActiveWorkspaceMembership(this.prisma, userId, workspaceId)
        const rows = await this.prisma.videoReviewRequest.findMany({
            where: { memberUserId: userId, workspaceId },
            orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
            include: reviewSummaryInclude,
        })
        return {
            items: await Promise.all(rows.map((r) => serializeReviewSummary(this.files, r))),
        }
    }
}
