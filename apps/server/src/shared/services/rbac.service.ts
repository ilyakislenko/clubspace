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
    // pin any club member.
    assertCanCreateGroupAs(ctx: CoachContext, coachUserId: string): void {
        if (this.canWriteAllGroups(ctx)) return
        if (coachUserId !== ctx.userId) {
            throw new ForbiddenError({
                message: 'Тренер может создавать только свои группы',
            })
        }
    }

    // Throws unless the caller coaches the group (primary or assistant) or
    // has admin scope. Admin scope still covers only this workspace's groups:
    // several callers write by groupId alone, so a group id from another club
    // must stop here.
    async assertCanWriteGroup(
        ctx: CoachContext,
        groupId: string,
    ): Promise<void> {
        if (this.canWriteAllGroups(ctx)) {
            const group = await this.prisma.group.findFirst({
                where: { id: groupId, workspaceId: ctx.workspaceId },
                select: { id: true },
            })
            if (!group) {
                throw new NotFoundError({ message: 'Группа не найдена' })
            }
            return
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

        if (!assignment) {
            throw new ForbiddenError({
                message: 'Тренер может менять только свои группы',
            })
        }
    }

    // True when the caller has admin scope or coaches (primary or assistant)
    // at least one group the member belongs to. Writes stay own-groups even
    // when coachSeesAllGroups widens reads.
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

    private async isMemberInOwnGroups(
        ctx: CoachContext,
        memberUserId: string,
    ): Promise<boolean> {
        const membership = await this.prisma.groupMember.findFirst({
            where: {
                userId: memberUserId,
                group: {
                    workspaceId: ctx.workspaceId,
                    coaches: { some: { userId: ctx.userId } },
                },
            },
            select: { groupId: true },
        })

        return membership !== null
    }
}
