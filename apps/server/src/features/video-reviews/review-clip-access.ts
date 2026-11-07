import type { PrismaService } from '../../infrastructure/prisma'
import { ForbiddenError } from '../../shared/errors/shared.errors'
import type { CoachContext, RbacService } from '../../shared/services/rbac.service'

/** The caller's club role as the guards resolved it (the owner is 'admin'). */
export type ReviewViewerRole = { roleName: string | null; isSuperAdmin: boolean }

/**
 * The caller's staff scope in this club, or null when they are not staff
 * (a member) — resolveCoachScope refuses those.
 */
export async function resolveReviewStaffScope(
    rbac: RbacService,
    p: { userId: string; workspaceId: string; viewer: ReviewViewerRole },
): Promise<CoachContext | null> {
    try {
        return await rbac.resolveCoachScope({
            userId: p.userId,
            workspaceId: p.workspaceId,
            roleName: p.viewer.roleName,
            isSuperAdmin: p.viewer.isSuperAdmin,
        })
    } catch (error) {
        if (error instanceof ForbiddenError) return null
        throw error
    }
}

/**
 * Members whose «Разборы» go to every staff member: those in no group that
 * has a coach — the same fallback notifyCoachesOfReview uses.
 */
export const uncoachedMemberWhere = (workspaceId: string) => ({
    groupMemberships: {
        none: { group: { workspaceId, coaches: { some: {} } } },
    },
})

/**
 * Whether club staff in `ctx` may see `memberUserId`'s clips: owner, club
 * admins and head coaches always; a coach only for members of their own
 * groups (ownGroupsWhere), or a member no group coach looks after.
 */
export async function staffCanSeeMemberReviews(
    rbac: RbacService,
    prisma: PrismaService,
    ctx: CoachContext,
    memberUserId: string,
): Promise<boolean> {
    if (await rbac.canWriteMember(ctx, memberUserId)) return true
    const uncoached = await prisma.user.findFirst({
        where: { id: memberUserId, ...uncoachedMemberWhere(ctx.workspaceId) },
        select: { id: true },
    })
    return uncoached !== null
}

/**
 * Whether `userId` may watch a «Разбор видео» clip right now: the club owner,
 * the clip's own (active, unexpired) member, or staff allowed to see that
 * member's reviews. Read from the database on every playlist fetch of the
 * manifest proxy, so a removed coach or member loses playback within the
 * token's life.
 */
export async function canWatchReviewClip(
    prisma: PrismaService,
    rbac: RbacService,
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
    const ctx = await resolveReviewStaffScope(rbac, {
        userId,
        workspaceId: clip.workspaceId,
        viewer: { roleName: member.role?.name ?? null, isSuperAdmin: false },
    })
    return ctx !== null && (await staffCanSeeMemberReviews(rbac, prisma, ctx, clip.ownerUserId))
}
