import { Feature, IFeatureHandler } from '@shelfjs/features'
import { z } from 'zod'

import {
    currentSubscriptionOrderBy,
    currentSubscriptionWhere,
} from '../../domains/subscriptions/current-subscriptions'
import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { paidInRangeWhere, refundsInRangeWhere } from '../../domains/metrics/revenue'
import { GetPlanFeature, GetPlanFeatureResponse } from './get-plan.feature'
import { PLAN_WRITE_REFUSAL, planDtoInclude, serializePlan } from './schemas'

const DAY_MS = 24 * 3600 * 1000

// The tariff page: who holds it and what it earned (net of the refunds of its
// abonements). Club money, like editing the tariff — the owner and admins only.
@Feature(GetPlanFeature)
export class GetPlanHandler
    implements IFeatureHandler<GetPlanFeature, GetPlanFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: GetPlanFeature): Promise<GetPlanFeatureResponse> {
        await assertClubAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            PLAN_WRITE_REFUSAL,
        )
        if (!z.string().uuid().safeParse(f.planId).success) {
            throw new NotFoundError({ message: 'Тариф не найден' })
        }
        const plan = await this.prisma.plan.findFirst({
            where: { id: f.planId, workspaceId: f.workspaceId },
            include: planDtoInclude,
        })
        if (!plan) throw new NotFoundError({ message: 'Тариф не найден' })

        const now = new Date()
        const since = new Date(now.getTime() - 30 * DAY_MS)
        const [held, sold, paid, refunded, autopayCount] = await Promise.all([
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
            // Refunds of this tariff's abonements made in the window, whenever
            // the abonement was sold (revenue = sales − refunds, by date).
            this.prisma.refund.aggregate({
                where: {
                    workspaceId: f.workspaceId,
                    currency: plan.currency,
                    subscription: { planId: plan.id },
                    ...refundsInRangeWhere({ gte: since }),
                },
                _sum: { amount: true },
            }),
            // Live autopay agreements on this tariff (the page's muted line
            // and the form's confirmations).
            this.prisma.memberAutopay.count({
                where: {
                    workspaceId: f.workspaceId,
                    planId: plan.id,
                    status: { in: ['ACTIVE', 'NEEDS_ACTION'] },
                },
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
            last30Days: {
                sold,
                revenue: (paid._sum.amountPaid ?? 0) - (refunded._sum.amount ?? 0),
            },
            autopayCount,
        }
    }
}
