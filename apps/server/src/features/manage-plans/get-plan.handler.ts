import { Feature, IFeatureHandler } from '@shelfjs/features'
import { z } from 'zod'

import {
    currentSubscriptionOrderBy,
    currentSubscriptionWhere,
} from '../../domains/subscriptions/current-subscriptions'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { paidInRangeWhere } from '../get-workspace-stats/revenue'
import { GetPlanFeature, GetPlanFeatureResponse } from './get-plan.feature'
import { planDtoInclude, serializePlan } from './schemas'

const DAY_MS = 24 * 3600 * 1000

// The tariff page. Who holds it and what it earned are the same scope as
// editing it: admin scope any tariff, a direction manager the tariffs of
// directions they run (every one of the set), a club-wide tariff admin only.
@Feature(GetPlanFeature)
export class GetPlanHandler
    implements IFeatureHandler<GetPlanFeature, GetPlanFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: GetPlanFeature): Promise<GetPlanFeatureResponse> {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        if (!z.string().uuid().safeParse(f.planId).success) {
            throw new NotFoundError({ message: 'Тариф не найден' })
        }
        const plan = await this.prisma.plan.findFirst({
            where: { id: f.planId, workspaceId: f.workspaceId },
            include: planDtoInclude,
        })
        if (!plan) throw new NotFoundError({ message: 'Тариф не найден' })
        const scope = plan.directions.map((d) => d.direction.id)
        await this.rbac.assertCanManageDirection(
            ctx,
            ...(scope.length > 0 ? scope : [null]),
        )

        const now = new Date()
        const since = new Date(now.getTime() - 30 * DAY_MS)
        const [held, sold, paid] = await Promise.all([
            this.prisma.subscription.findMany({
                where: {
                    workspaceId: f.workspaceId,
                    planId: plan.id,
                    ...currentSubscriptionWhere(now),
                },
                orderBy: currentSubscriptionOrderBy,
                select: {
                    id: true,
                    startDate: true,
                    endDate: true,
                    durationDays: true,
                    createdAt: true,
                    classesTotal: true,
                    classesRemaining: true,
                    isPaid: true,
                    workspaceMember: {
                        select: {
                            userId: true,
                            user: {
                                select: {
                                    firstname: true,
                                    lastname: true,
                                    email: true,
                                },
                            },
                        },
                    },
                },
            }),
            this.prisma.subscription.count({
                where: {
                    workspaceId: f.workspaceId,
                    planId: plan.id,
                    status: { not: 'CANCELLED' },
                    createdAt: { gte: since },
                },
            }),
            this.prisma.subscription.aggregate({
                where: {
                    workspaceId: f.workspaceId,
                    planId: plan.id,
                    currency: plan.currency,
                    ...paidInRangeWhere({ gte: since }),
                },
                _sum: { amountPaid: true },
            }),
        ])

        return {
            plan: serializePlan(plan),
            holders: held.flatMap((s) =>
                s.workspaceMember
                    ? [
                          {
                              subscriptionId: s.id,
                              userId: s.workspaceMember.userId,
                              firstname: s.workspaceMember.user.firstname,
                              lastname: s.workspaceMember.user.lastname,
                              email: s.workspaceMember.user.email,
                              startDate: s.startDate?.toISOString() ?? null,
                              endDate: s.endDate?.toISOString() ?? null,
                              durationDays: s.durationDays,
                              createdAt: s.createdAt.toISOString(),
                              classesTotal: s.classesTotal,
                              classesRemaining: s.classesRemaining,
                              isPaid: s.isPaid,
                          },
                      ]
                    : [],
            ),
            last30Days: { sold, revenue: paid._sum.amountPaid ?? 0 },
        }
    }
}
