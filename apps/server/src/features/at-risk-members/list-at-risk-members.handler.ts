import { Feature, IFeatureHandler } from '@shelfjs/features'

import { loadWorkspaceRisk } from '../../domains/retention/load-workspace-risk'
import { summarizeRisk } from '../../domains/retention/risk-signals'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ListAtRiskMembersFeature,
    ListAtRiskMembersFeatureResponse,
} from './list-at-risk-members.feature'
import { serializeAtRiskMember } from './schemas'

@Feature(ListAtRiskMembersFeature)
export class ListAtRiskMembersHandler
    implements
        IFeatureHandler<
            ListAtRiskMembersFeature,
            ListAtRiskMembersFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute({
        payload,
        workspaceId,
        invokerUserId,
        roleName,
        isSuperAdmin,
    }: ListAtRiskMembersFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName,
            isSuperAdmin,
        })

        if (payload.gymId) {
            const gym = await this.prisma.gym.findFirst({
                where: { id: payload.gymId, workspaceId },
                select: { id: true },
            })
            if (!gym) throw new NotFoundError({ message: 'Зал не найден' })
        }
        if (payload.groupId) {
            const group = await this.prisma.group.findFirst({
                where: { id: payload.groupId, workspaceId },
                select: { id: true },
            })
            if (!group) throw new NotFoundError({ message: 'Группа не найдена' })
        }

        // The junction table (not Group.coachId) so assistant coaches count.
        const ownOnly =
            !this.rbac.canSeeAllGroups(ctx) || payload.scope === 'mine'
        const canWriteAll = this.rbac.canWriteAllGroups(ctx)
        const coachGroupIds =
            ownOnly || !canWriteAll
                ? new Set(
                      (
                          await this.prisma.groupCoach.findMany({
                              where: {
                                  userId: ctx.userId,
                                  group: { workspaceId },
                              },
                              select: { groupId: true },
                          })
                      ).map((g) => g.groupId),
                  )
                : null
        const ownGroupIds = ownOnly ? coachGroupIds : null

        const entries = await loadWorkspaceRisk(this.prisma, {
            workspaceId,
            now: new Date(),
        })

        // Same rule as logging a contact: admins any member, a coach only
        // members of their own groups (even with read-all).
        const kept = entries
            .map((e) => ({
                ...e,
                canContact:
                    canWriteAll ||
                    e.groups.some((g) => coachGroupIds?.has(g.id)),
            }))
            .map((e) =>
                ownGroupIds
                    ? { ...e, groups: e.groups.filter((g) => ownGroupIds.has(g.id)) }
                    : e,
            )
            .filter(
                (e) =>
                    (!ownGroupIds || e.groups.length > 0) &&
                    (!payload.gymId ||
                        e.groups.some((g) => g.gymId === payload.gymId)) &&
                    (!payload.groupId ||
                        e.groups.some((g) => g.id === payload.groupId)),
            )

        return {
            data: kept.map((e) => serializeAtRiskMember(e)),
            summary: summarizeRisk(kept),
        }
    }
}
