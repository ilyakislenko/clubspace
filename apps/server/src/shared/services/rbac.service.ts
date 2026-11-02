import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../infrastructure/prisma'
import {
    type RoleName,
    WORKSPACE_ADMINS,
} from '../decorators/roles.decorator'
import { ForbiddenError, NotFoundError } from '../errors/shared.errors'

export type CoachScope =
    // Full read+write across the workspace. Owner, head_coach, admin.
    | 'admin'
    // Coach in a workspace that has coachSeesAllGroups=true. Reads all,
    // writes only own groups.
    | 'coach_read_all'
    // Coach in a workspace that has coachSeesAllGroups=false. Reads and
    // writes only own groups.
    | 'coach_own_only'

export type CoachContext = {
    scope: CoachScope
    userId: string
    workspaceId: string
    // Pinned so handlers can render an "is owner" badge without re-fetching.
    workspaceOwnerId: string
}

// How a non-admin reached a group: as its coach, or as the manager of its
// direction.
export type GroupWriteAccess = 'admin' | 'coach' | 'direction'

// Groups a coach acts on as their own: the ones they coach plus every group
// of a direction they manage.
export const ownGroupsWhere = (userId: string) => ({
    OR: [
        { coaches: { some: { userId } } },
        { direction: { managers: { some: { userId } } } },
    ],
})

@Injectable()
export class RbacService {
    constructor(private readonly prisma: PrismaService) {}

    // Call once per endpoint; consult the result when building where-clauses.
    async resolveCoachScope(params: {
        userId: string
        workspaceId: string
        roleName: string | null
        isSuperAdmin: boolean
    }): Promise<CoachContext> {
        const { userId, workspaceId, roleName, isSuperAdmin } = params

        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { ownerId: true, coachSeesAllGroups: true },
        })

        if (!workspace) {
            throw new ForbiddenError({ message: 'Клуб не найден' })
        }

        const baseCtx = {
            userId,
            workspaceId,
            workspaceOwnerId: workspace.ownerId,
        }

        if (isSuperAdmin) {
            return { ...baseCtx, scope: 'admin' }
        }

        if (workspace.ownerId === userId) {
            return { ...baseCtx, scope: 'admin' }
        }

        if (roleName && WORKSPACE_ADMINS.includes(roleName as RoleName)) {
            return { ...baseCtx, scope: 'admin' }
        }

        if (roleName === 'coach') {
            return {
                ...baseCtx,
                scope: workspace.coachSeesAllGroups
                    ? 'coach_read_all'
                    : 'coach_own_only',
            }
        }

        // Endpoints allowing coach scope must @Roles('coach', ...) so RoleGuard
        // rejects 'user' before this is consulted.
        throw new ForbiddenError({ message: 'Нужны права администратора клуба' })
    }

    canSeeAllGroups(ctx: CoachContext): boolean {
        return ctx.scope === 'admin' || ctx.scope === 'coach_read_all'
    }

    canWriteAllGroups(ctx: CoachContext): boolean {
        return ctx.scope === 'admin'
    }

    // Coaches can only spawn groups they personally lead; admin scope can
    // pin any club member, a direction manager any coach for a group of a
    // direction they run.
    async assertCanCreateGroupAs(
        ctx: CoachContext,
        coachUserId: string,
        directionId: string | null,
    ): Promise<void> {
        if (this.canWriteAllGroups(ctx)) return
        if (coachUserId === ctx.userId) return
        if (directionId && (await this.managesAll(ctx, [directionId]))) return
        throw new ForbiddenError({
            message: 'Тренер может создавать только свои группы',
        })
    }

    // Throws unless the caller coaches the group (primary or assistant), runs
    // its direction, or has admin scope. Admin scope still covers only this
    // workspace's groups: several callers write by groupId alone, so a group
    // id from another club must stop here. Returns how access was granted so
    // a direction manager moving the group can be held to the target too.
    async assertCanWriteGroup(
        ctx: CoachContext,
        groupId: string,
    ): Promise<GroupWriteAccess> {
        if (this.canWriteAllGroups(ctx)) {
            const group = await this.prisma.group.findFirst({
                where: { id: groupId, workspaceId: ctx.workspaceId },
                select: { id: true },
            })
            if (!group) {
                throw new NotFoundError({ message: 'Группа не найдена' })
            }
            return 'admin'
        }

        // The junction holds the primary coach (synced at create-group) plus
        // assistants, so one query covers both.
        const assignment = await this.prisma.groupCoach.findFirst({
            where: {
                groupId,
                userId: ctx.userId,
                group: { workspaceId: ctx.workspaceId },
            },
            select: { role: true },
        })
        if (assignment) return 'coach'

        const group = await this.prisma.group.findFirst({
            where: { id: groupId, workspaceId: ctx.workspaceId },
            select: { directionId: true },
        })
        if (
            group?.directionId &&
            (await this.managesAll(ctx, [group.directionId]))
        ) {
            return 'direction'
        }

        throw new ForbiddenError({
            message: 'Тренер может менять только свои группы',
        })
    }

    // Marking attendance of one class: whoever may write the group, any coach
    // of a club with «Тренеры могут отмечать в чужих группах без замены», or
    // the approved substitute of that very class (occurrenceKey of a slot
    // occurrence; null for an ad-hoc class, which has no substitutes). The
    // group must belong to this club in every branch.
    async assertCanMarkClass(
        ctx: CoachContext,
        groupId: string,
        occurrenceKey: string | null,
    ): Promise<void> {
        try {
            await this.assertCanWriteGroup(ctx, groupId)
            return
        } catch (e) {
            if (!(e instanceof ForbiddenError)) throw e
        }
        const group = await this.prisma.group.findFirst({
            where: { id: groupId, workspaceId: ctx.workspaceId },
            select: { workspace: { select: { coachesMarkAnyClass: true } } },
        })
        if (!group) throw new NotFoundError({ message: 'Группа не найдена' })
        if (group.workspace.coachesMarkAnyClass) return
        if (occurrenceKey && (await this.isApprovedSubstitute(ctx, groupId, occurrenceKey))) {
            return
        }
        throw new ForbiddenError({
            message:
                'Отмечать посещаемость чужой группы можно после одобренной замены',
        })
    }

    // True when the caller may mark every class of the club without a
    // substitution: admin scope, or a coach while the club allows it.
    async canMarkAnyClass(ctx: CoachContext): Promise<boolean> {
        if (this.canWriteAllGroups(ctx)) return true
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: ctx.workspaceId },
            select: { coachesMarkAnyClass: true },
        })
        return !!workspace?.coachesMarkAnyClass
    }

    private async isApprovedSubstitute(
        ctx: CoachContext,
        groupId: string,
        occurrenceKey: string,
    ): Promise<boolean> {
        const row = await this.prisma.classSubstitution.findFirst({
            where: {
                workspaceId: ctx.workspaceId,
                occurrenceKey,
                groupId,
                substituteId: ctx.userId,
                status: 'APPROVED',
            },
            select: { id: true },
        })
        return row !== null
    }

    // The one rule for writes to direction-owned entities (ladders, gradings,
    // promotions, achievements, events, announcements, course audience,
    // tariffs, groups beyond the coach's own). Pass the entity's current
    // direction and, on a move, the target: null = club-wide (admin only),
    // undefined = field not sent (skipped). Admin scope passes; anyone else
    // must run every direction named. Fails closed when nothing is named.
    async assertCanManageDirection(
        ctx: CoachContext,
        ...directionIds: Array<string | null | undefined>
    ): Promise<void> {
        if (this.canWriteAllGroups(ctx)) return
        const named = directionIds.filter((d) => d !== undefined)
        if (named.length === 0 || named.includes(null)) {
            throw new ForbiddenError({
                message: 'Нужны права администратора клуба',
            })
        }
        if (!(await this.managesAll(ctx, named as string[]))) {
            throw new ForbiddenError({
                message:
                    'Нужны права администратора клуба или руководителя этого направления',
            })
        }
    }

    // Directions the caller runs; null = admin scope (every direction and
    // club-wide rows).
    async managedDirectionIds(ctx: CoachContext): Promise<string[] | null> {
        if (this.canWriteAllGroups(ctx)) return null
        const rows = await this.prisma.directionManager.findMany({
            where: { workspaceId: ctx.workspaceId, userId: ctx.userId },
            select: { directionId: true },
        })
        return rows.map((r) => r.directionId)
    }

    // Gate for the admin-side screens opened to direction managers (ladder,
    // grading, achievement, announcement lists): admin → null (no filter);
    // a direction manager → the directions to filter by; a coach who runs
    // none is refused as before.
    async assertManagesDirections(ctx: CoachContext): Promise<string[] | null> {
        const ids = await this.managedDirectionIds(ctx)
        if (ids !== null && ids.length === 0) {
            throw new ForbiddenError({
                message: 'Нужны права администратора клуба',
            })
        }
        return ids
    }

    private async managesAll(
        ctx: CoachContext,
        directionIds: string[],
    ): Promise<boolean> {
        const ids = [...new Set(directionIds)]
        const count = await this.prisma.directionManager.count({
            where: {
                workspaceId: ctx.workspaceId,
                userId: ctx.userId,
                directionId: { in: ids },
            },
        })
        return count === ids.length
    }

    // True when the caller has admin scope or coaches (primary or assistant)
    // at least one group the member belongs to, or manages that group's
    // direction (ownGroupsWhere). Writes stay own-groups even when
    // coachSeesAllGroups widens reads.
    async canWriteMember(
        ctx: CoachContext,
        memberUserId: string,
    ): Promise<boolean> {
        if (this.canWriteAllGroups(ctx)) return true
        return this.isMemberInOwnGroups(ctx, memberUserId)
    }

    async assertCanWriteMember(
        ctx: CoachContext,
        memberUserId: string,
    ): Promise<void> {
        if (!(await this.canWriteMember(ctx, memberUserId))) {
            throw new ForbiddenError({
                message: 'Участник не состоит в ваших группах',
            })
        }
    }

    // Read variant: admins and coaches who see all groups read any member;
    // coach_own_only is limited to members of their own groups.
    async assertCanReadMember(
        ctx: CoachContext,
        memberUserId: string,
    ): Promise<void> {
        if (this.canSeeAllGroups(ctx)) return
        if (!(await this.isMemberInOwnGroups(ctx, memberUserId))) {
            throw new ForbiddenError({
                message: 'Участник не состоит в ваших группах',
            })
        }
    }

    // Ids of this club's groups the caller acts on as their own
    // (ownGroupsWhere): the scope of every coach-narrowed list, so a list
    // matches what assertCanReadMember / canWriteMember let them open.
    async ownGroupIds(ctx: CoachContext): Promise<string[]> {
        const rows = await this.prisma.group.findMany({
            where: { workspaceId: ctx.workspaceId, ...ownGroupsWhere(ctx.userId) },
            select: { id: true },
        })
        return rows.map((r) => r.id)
    }

    // Students of those groups (distinct user ids).
    async ownGroupMemberIds(ctx: CoachContext): Promise<string[]> {
        const rows = await this.prisma.groupMember.findMany({
            where: {
                group: { workspaceId: ctx.workspaceId, ...ownGroupsWhere(ctx.userId) },
            },
            distinct: ['userId'],
            select: { userId: true },
        })
        return rows.map((r) => r.userId)
    }

    private async isMemberInOwnGroups(
        ctx: CoachContext,
        memberUserId: string,
    ): Promise<boolean> {
        const membership = await this.prisma.groupMember.findFirst({
            where: {
                userId: memberUserId,
                group: {
                    workspaceId: ctx.workspaceId,
                    ...ownGroupsWhere(ctx.userId),
                },
            },
            select: { groupId: true },
        })

        return membership !== null
    }
}
