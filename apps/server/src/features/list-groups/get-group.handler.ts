import { Feature, IFeatureHandler } from '@shelfjs/features'
import { z } from 'zod'

import { loadWorkspaceRisk } from '../../domains/retention/load-workspace-risk'
import {
    currentSubscriptionOrderBy,
    currentSubscriptionWhere,
} from '../../domains/subscriptions/current-subscriptions'
import { PrismaService } from '../../infrastructure/prisma'
import {
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { ownGroupsWhere, RbacService } from '../../shared/services/rbac.service'
import { GetGroupFeature, GetGroupFeatureResponse } from './get-group.feature'
import { groupRowInclude, serializeGroupRow } from './schemas'

// One group for its page. Reads follow the list: admin scope and
// coach_read_all see any group of the club, coach_own_only only its own
// (ownGroupsWhere — coached or of a managed direction). Abonements and risk
// of the roster only for whoever runs the group.
@Feature(GetGroupFeature)
export class GetGroupHandler
    implements IFeatureHandler<GetGroupFeature, GetGroupFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: GetGroupFeature): Promise<GetGroupFeatureResponse> {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        if (!z.string().uuid().safeParse(f.groupId).success) {
            throw new NotFoundError({ message: 'Группа не найдена' })
        }
        const now = new Date()
        const group = await this.prisma.group.findFirst({
            where: { id: f.groupId, workspaceId: f.workspaceId },
            include: groupRowInclude(now),
        })
        if (!group) throw new NotFoundError({ message: 'Группа не найдена' })

        const isAdmin = this.rbac.canWriteAllGroups(ctx)
        const isOwn =
            !isAdmin &&
            (await this.prisma.group.count({
                where: {
                    id: group.id,
                    workspaceId: f.workspaceId,
                    ...ownGroupsWhere(ctx.userId),
                },
            })) > 0
        if (!this.rbac.canSeeAllGroups(ctx) && !isOwn) {
            throw new ForbiddenError({
                message: 'Можно открыть только свои группы',
            })
        }
        const canEdit = isAdmin || isOwn

        const row = serializeGroupRow(group)
        const userIds = row.members.map((m) => m.userId)
        const [subscriptions, risk] =
            canEdit && userIds.length > 0
                ? await Promise.all([
                      this.prisma.subscription.findMany({
                          where: {
                              workspaceId: f.workspaceId,
                              ...currentSubscriptionWhere(now),
                              workspaceMember: { userId: { in: userIds } },
                          },
                          orderBy: currentSubscriptionOrderBy,
                          select: {
                              id: true,
                              planId: true,
                              plan: { select: { name: true } },
                              startDate: true,
                              endDate: true,
                              durationDays: true,
                              createdAt: true,
                              classesTotal: true,
                              classesRemaining: true,
                              isPaid: true,
                              workspaceMember: { select: { userId: true } },
                          },
                      }),
                      loadWorkspaceRisk(this.prisma, {
                          workspaceId: f.workspaceId,
                          now,
                          userIds,
                      }),
                  ])
                : [[], []]
        const riskByUser = new Map(risk.map((r) => [r.userId, r]))

        return {
            ...row,
            canEdit,
            members: row.members.map((m) => {
                const entry = riskByUser.get(m.userId)
                return {
                    ...m,
                    subscriptions: subscriptions
                        .filter((s) => s.workspaceMember?.userId === m.userId)
                        .map((s) => ({
                            id: s.id,
                            planId: s.planId,
                            planName: s.plan.name,
                            startDate: s.startDate?.toISOString() ?? null,
                            endDate: s.endDate?.toISOString() ?? null,
                            durationDays: s.durationDays,
                            createdAt: s.createdAt.toISOString(),
                            classesTotal: s.classesTotal,
                            classesRemaining: s.classesRemaining,
                            isPaid: s.isPaid,
                        })),
                    risk: entry
                        ? { reason: entry.risk.reason, text: entry.factsText }
                        : null,
                }
            }),
        }
    }
}
