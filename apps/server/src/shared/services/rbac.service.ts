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

        if (isSuperAdmin) {
            return { scope: 'admin', userId, workspaceId }
        }

        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { ownerId: true, coachSeesAllGroups: true },
        })

        if (!workspace) {
            throw new ForbiddenError({ message: 'Workspace not found' })
        }

        if (workspace.ownerId === userId) {
            return { scope: 'admin', userId, workspaceId }
        }

        if (
            roleName === 'admin' ||
            roleName === 'head_coach' ||
            roleName === 'moderator'
        ) {
            return { scope: 'admin', userId, workspaceId }
        }

        if (roleName === 'coach') {
            return {
                scope: workspace.coachSeesAllGroups
                    ? 'coach_read_all'
                    : 'coach_own_only',
                userId,
                workspaceId,
            }
        }

        // Default for 'user' and unknown roles — no admin access at all.
        // Endpoints that allow coach scope must @Roles('coach', ...) so
        // RoleGuard rejects user before this is consulted.
        throw new ForbiddenError({ message: 'Not authorised for admin scope' })
    }

    // Returns true when the caller is allowed to read/write everything
    // in the workspace, false when they should be scoped to own groups.
    canSeeAllGroups(ctx: CoachContext): boolean {
        return ctx.scope === 'admin' || ctx.scope === 'coach_read_all'
    }

    canWriteAllGroups(ctx: CoachContext): boolean {
        return ctx.scope === 'admin'
    }

    // Throws if the caller doesn't own (coach) the given group, unless
    // their scope is 'admin'. Used by update-group, delete-group,
    // add/remove-group-member.
    async assertCanWriteGroup(
        ctx: CoachContext,
        groupId: string,
    ): Promise<void> {
        if (this.canWriteAllGroups(ctx)) return

        const group = await this.prisma.group.findFirst({
            where: { id: groupId, workspaceId: ctx.workspaceId },
            select: { coachId: true },
        })

        if (!group) {
            throw new ForbiddenError({ message: 'Group not found in scope' })
        }
        if (group.coachId !== ctx.userId) {
            throw new ForbiddenError({
                message: 'Coach can only modify their own groups',
            })
        }
    }
}
