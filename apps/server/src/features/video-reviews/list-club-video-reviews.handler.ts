import { Feature, IFeatureHandler } from '@shelfjs/features'

import { FilesService } from '../../infrastructure/files/services/files.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertActiveWorkspaceMembership } from '../../shared/access/assert-membership'
import { ForbiddenError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ListClubVideoReviewsFeature,
    ListClubVideoReviewsFeatureResponse,
} from './list-club-video-reviews.feature'
import { resolveReviewStaffScope, reviewStaffMemberWhere } from './review-clip-access'
import { reviewSummaryInclude, serializeReviewSummary } from './schemas'
import { REQUEST_STATUS_ORDER, type RequestStatus } from './video-reviews-utils'

// The staff list shows at most this many requests.
export const CLUB_REVIEWS_LIMIT = 200

@Feature(ListClubVideoReviewsFeature)
export class ListClubVideoReviewsHandler
    implements
        IFeatureHandler<ListClubVideoReviewsFeature, ListClubVideoReviewsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly files: FilesService,
        private readonly rbac: RbacService,
    ) {}

    async execute({
        userId,
        workspaceId,
        viewer,
        payload,
    }: ListClubVideoReviewsFeature): Promise<ListClubVideoReviewsFeatureResponse> {
        await assertActiveWorkspaceMembership(this.prisma, userId, workspaceId)
        const ctx = await resolveReviewStaffScope(this.rbac, { userId, workspaceId, viewer })
        if (!ctx) {
            throw new ForbiddenError({ message: 'Разборы учеников видят только тренеры клуба' })
        }
        const memberScope = await reviewStaffMemberWhere({
            workspaceId,
            clubWide: this.rbac.canWriteAllGroups(ctx),
            ownGroupMemberIds: () => this.rbac.ownGroupMemberIds(ctx),
        })
        const rows = await this.prisma.videoReviewRequest.findMany({
            where: {
                workspaceId,
                ...memberScope,
                ...(payload.status && { status: payload.status }),
                // A clip still being uploaded isn't a request yet.
                clip: { status: { not: 'uploading' } },
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: CLUB_REVIEWS_LIMIT,
            include: reviewSummaryInclude,
        })
        // Waiting ones first (oldest first — they waited longest), then the
        // rest newest first.
        const sorted = [...rows].sort((a, b) => {
            const byStatus =
                REQUEST_STATUS_ORDER[a.status as RequestStatus] -
                REQUEST_STATUS_ORDER[b.status as RequestStatus]
            if (byStatus !== 0) return byStatus
            const byTime = a.createdAt.getTime() - b.createdAt.getTime()
            return a.status === 'open' ? byTime : -byTime
        })
        return {
            items: await Promise.all(sorted.map((r) => serializeReviewSummary(this.files, r))),
        }
    }
}
