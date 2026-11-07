import type { PrismaService } from '../../infrastructure/prisma'
import { assertActiveWorkspaceMembership } from '../../shared/access/assert-membership'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { reviewSummaryInclude, type ReviewWithClip } from './schemas'

/**
 * The caller's own request in this club (after the membership gate). Anyone
 * else's — staff included: completing or deleting is the member's — is a 404.
 */
export async function loadOwnReview(
    prisma: PrismaService,
    p: { userId: string; workspaceId: string; requestId: string },
): Promise<ReviewWithClip> {
    await assertActiveWorkspaceMembership(prisma, p.userId, p.workspaceId)
    const request = await prisma.videoReviewRequest.findUnique({
        where: { id: p.requestId },
        include: reviewSummaryInclude,
    })
    if (!request || request.workspaceId !== p.workspaceId || request.memberUserId !== p.userId) {
        throw new NotFoundError({ message: 'Разбор не найден' })
    }
    return request
}
