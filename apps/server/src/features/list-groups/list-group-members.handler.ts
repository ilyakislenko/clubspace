import { Feature, IFeatureHandler } from '@shelfjs/features'
import { z } from 'zod'

import { loadWorkspaceRisk } from '../../domains/retention/load-workspace-risk'
import {
    currentSubscriptionOrderBy,
    currentSubscriptionWhere,
} from '../../domains/subscriptions/current-subscriptions'
import { userSearchWhere } from '../../domains/users/user-search'
import { Prisma, PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { resolveGroupAccess } from './group-access'
import {
    GROUP_MEMBERS_DEFAULT_PER_PAGE,
    ListGroupMembersFeature,
    ListGroupMembersFeatureResponse,
} from './list-group-members.feature'
import { userRefSelect } from './schemas'

// One page of a group's roster for its card: whoever may open the group
// (resolveGroupAccess), searched and paged server-side.
@Feature(ListGroupMembersFeature)
export class ListGroupMembersHandler
    implements
        IFeatureHandler<
            ListGroupMembersFeature,
            ListGroupMembersFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(
        f: ListGroupMembersFeature,
    ): Promise<ListGroupMembersFeatureResponse> {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        if (!z.string().uuid().safeParse(f.groupId).success) {
            throw new NotFoundError({ message: 'Группа не найдена' })
        }
        const group = await this.prisma.group.findFirst({
            where: { id: f.groupId, workspaceId: f.workspaceId },
            select: { id: true },
        })
        if (!group) throw new NotFoundError({ message: 'Группа не найдена' })
        const { canEdit } = await resolveGroupAccess(
            this.prisma,
            this.rbac,
            ctx,
            group.id,
        )

        const curPage = f.payload.curPage ?? 1
        const perPage = f.payload.perPage ?? GROUP_MEMBERS_DEFAULT_PER_PAGE
        const where: Prisma.GroupMemberWhereInput = {
            groupId: group.id,
            ...(f.payload.q && {
                AND: userSearchWhere(f.payload.q).map((user) => ({ user })),
            }),
        }
        const [total, rows] = await Promise.all([
            this.prisma.groupMember.count({ where }),
            this.prisma.groupMember.findMany({
                where,
                orderBy: [
                    { user: { lastname: 'asc' } },
                    { user: { firstname: 'asc' } },
                    { userId: 'asc' },
                ],
                skip: (curPage - 1) * perPage,
                take: perPage,
                include: { user: userRefSelect },
            }),
        ])

        const now = new Date()
        const userIds = rows.map((r) => r.userId)
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
            data: rows.map((r) => {
                const entry = riskByUser.get(r.userId)
                return {
                    userId: r.user.id,
                    email: r.user.email,
                    firstname: r.user.firstname,
                    lastname: r.user.lastname,
                    joinedAt: r.joinedAt.toISOString(),
                    subscriptions: subscriptions
                        .filter((s) => s.workspaceMember?.userId === r.userId)
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
            total,
            curPage,
            perPage,
        }
    }
}
