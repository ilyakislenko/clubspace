import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../infrastructure/prisma'
import { ForbiddenError } from '../errors/shared.errors'

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
    // Workspace owner — pinned in the context so handlers can render
    // "is owner" badges without re-fetching the workspace, and so the
    // 'admin' scope decision can be reused without duplicating the
    // findUnique a few microseconds later.
    workspaceOwnerId: string
}

@Injectable()
export class RbacService {
    constructor(private readonly prisma: PrismaService) {}

    // Decides what slice of a workspace the caller is allowed to see and
    // edit. Endpoints that need scoping call this once and consult the
    // result when building Prisma where-clauses.
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

        if (
            roleName === 'admin' ||
            roleName === 'head_coach' ||
            roleName === 'moderator'
        ) {
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

        // Default for 'user' and unknown roles — no admin access at all.
        // Endpoints that allow coach scope must @Roles('coach', ...) so
        // RoleGuard rejects user before this is consulted.
        throw new ForbiddenError({ message: 'Нужны права администратора клуба' })
    }

    // Returns true when the caller is allowed to read/write everything
    // in the workspace, false when they should be scoped to own groups.
    canSeeAllGroups(ctx: CoachContext): boolean {
        return ctx.scope === 'admin' || ctx.scope === 'coach_read_all'
    }

    canWriteAllGroups(ctx: CoachContext): boolean {
        return ctx.scope === 'admin'
    }

    // Throws unless the caller is allowed to create a group whose coach
    // would be the given user id. Coaches can only spawn groups they
    // personally lead; admin scope can pin any club member.
    assertCanCreateGroupAs(ctx: CoachContext, coachUserId: string): void {
        if (this.canWriteAllGroups(ctx)) return
        if (coachUserId !== ctx.userId) {
            throw new ForbiddenError({
                message: 'Тренер может создавать только свои группы',
            })
        }
    }

    // Throws if the caller isn't a coach of the given group (primary or
    // assistant), unless their scope is 'admin'. Used by update-group,
    // delete-group, add/remove-group-member, slot/exception writes.
    async assertCanWriteGroup(
        ctx: CoachContext,
        groupId: string,
    ): Promise<void> {
        if (this.canWriteAllGroups(ctx)) return

        // Single query against the GroupCoach junction — covers the
        // primary coach (synced into the junction at create-group time)
        // plus any assistants. If the row exists, the caller has write
        // access; otherwise they don't.
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
}
