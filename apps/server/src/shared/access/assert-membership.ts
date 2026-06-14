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

    if (!membership) {
        throw new ForbiddenError({ message: 'Not a member of this workspace' })
    }

    if (workspaceRow?.ownerId === userId) {
        return
    }

    if (membership.status !== 'ACTIVE') {
        throw new ForbiddenError({ message: 'Member is not active' })
    }

    if (membership.accessUntil && membership.accessUntil < new Date()) {
        throw new ForbiddenError({ message: 'Access window has expired' })
    }
}
