import type { PrismaService } from '../../infrastructure/prisma'
import { type RoleName, STAFF_ROLES } from '../../shared/decorators/roles.decorator'

/**
 * Whether `userId` may watch a «Разбор видео» clip right now: the club owner,
 * or an active (unexpired) member who is either the clip's owner or staff.
 * Read from the database on every playlist fetch of the manifest proxy, so a
 * removed coach or member loses playback within the token's life.
 */
export async function canWatchReviewClip(
    prisma: PrismaService,
    clip: { workspaceId: string; ownerUserId: string },
    userId: string,
): Promise<boolean> {
    const [workspace, member] = await Promise.all([
        prisma.workspace.findUnique({
            where: { id: clip.workspaceId },
            select: { ownerId: true },
        }),
        prisma.workspaceMember.findUnique({
            where: { userId_workspaceId: { userId, workspaceId: clip.workspaceId } },
            select: { status: true, accessUntil: true, role: { select: { name: true } } },
        }),
    ])
    if (workspace?.ownerId === userId) return true
    if (!member || member.status !== 'ACTIVE') return false
    if (member.accessUntil && member.accessUntil < new Date()) return false
    if (clip.ownerUserId === userId) return true
    return STAFF_ROLES.includes((member.role?.name ?? '') as RoleName)
}
