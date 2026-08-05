import { PrismaService } from '../../infrastructure/prisma'
import { ForbiddenError } from '../errors/shared.errors'

/**
 * Throws unless `userId` is allowed to act on resources in `workspaceId`:
 * either the workspace owner, or a member whose status is ACTIVE and whose
 * access window hasn't expired. Mirrors the gate in VideoService.getPlaybackUrl
 * so per-user endpoints that take a bare resource id (progress, favorites)
 * can't be used cross-tenant by any authenticated user.
 */
export async function assertActiveWorkspaceMembership(
    prisma: PrismaService,
    userId: string,
    workspaceId: string,
): Promise<void> {
    const [workspaceRow, membership] = await Promise.all([
        prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { ownerId: true },
        }),
        prisma.workspaceMember.findUnique({
            where: { userId_workspaceId: { userId, workspaceId } },
            select: { status: true, accessUntil: true },
        }),
    ])

    // Owner is always allowed — and the normal workspace-creation flow does
    // NOT create a membership row for the owner, so this bypass must come
    // before the membership existence check below. Otherwise an owner with no
    // member row would be wrongly forbidden (contradicting the doc above).
    if (workspaceRow?.ownerId === userId) {
        return
    }

    if (!membership) {
        throw new ForbiddenError({ message: 'Вы не участник этого клуба' })
    }

    if (membership.status !== 'ACTIVE') {
        throw new ForbiddenError({ message: 'Участник неактивен' })
    }

    if (membership.accessUntil && membership.accessUntil < new Date()) {
        throw new ForbiddenError({ message: 'Срок доступа истёк' })
    }
}
