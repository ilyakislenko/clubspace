import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    awaitingPaymentWhere,
    countAwaitingPaymentMembers,
} from '../../domains/subscriptions/renewal-rules'
import { PrismaService } from '../../infrastructure/prisma'
import { assertSportLead } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    analyticsScopeMemberWhere,
    resolveAnalyticsScope,
} from '../club-analytics/analytics-scope'
import {
    AWAITING_DEFAULT_PER_PAGE,
    ListAwaitingPaymentFeature,
    ListAwaitingPaymentFeatureResponse,
} from './list-awaiting-payment.feature'

@Feature(ListAwaitingPaymentFeature)
export class ListAwaitingPaymentHandler
    implements
        IFeatureHandler<
            ListAwaitingPaymentFeature,
            ListAwaitingPaymentFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(
        f: ListAwaitingPaymentFeature,
    ): Promise<ListAwaitingPaymentFeatureResponse> {
        await assertSportLead(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            'Смотреть неоплаченные абонементы может только администратор клуба',
        )

        const { scope } = await resolveAnalyticsScope(
            this.prisma,
            this.rbac,
            f,
            f.payload,
        )
        const memberWhere = analyticsScopeMemberWhere(scope)
        const curPage = f.payload.curPage ?? 1
        const perPage = f.payload.perPage ?? AWAITING_DEFAULT_PER_PAGE

        // Same rows as the dashboard receivable.
        const where = {
            ...awaitingPaymentWhere(f.workspaceId),
            ...(scope.groupIds === null ? {} : { workspaceMember: memberWhere }),
        }
        const [total, members, subs] = await Promise.all([
            this.prisma.subscription.count({ where }),
            countAwaitingPaymentMembers(this.prisma, f.workspaceId, {
                memberWhere,
            }),
            this.prisma.subscription.findMany({
                where,
                orderBy: [
                    { startDate: { sort: 'asc', nulls: 'last' } },
                    { createdAt: 'asc' },
                    { id: 'asc' },
                ],
                skip: (curPage - 1) * perPage,
                take: perPage,
                select: {
                    id: true,
                    amountPaid: true,
                    currency: true,
                    startDate: true,
                    createdAt: true,
                    plan: { select: { id: true, name: true } },
                    workspaceMember: {
                        select: {
                            userId: true,
                            user: {
                                select: {
                                    firstname: true,
                                    lastname: true,
                                    email: true,
                                    phone: true,
                                },
                            },
                        },
                    },
                },
            }),
        ])

        return {
            total,
            members,
            curPage,
            perPage,
            data: subs.flatMap((s) => {
                const m = s.workspaceMember
                if (!m) return []
                return [
                    {
                        subscriptionId: s.id,
                        userId: m.userId,
                        // Staff-only list: a nameless member shows by e-mail.
                        memberName:
                            [m.user.firstname, m.user.lastname]
                                .filter(Boolean)
                                .join(' ')
                                .trim() ||
                            m.user.email ||
                            'без имени',
                        memberPhone: m.user.phone,
                        planId: s.plan.id,
                        planName: s.plan.name,
                        amount: s.amountPaid,
                        currency: s.currency,
                        startDate: s.startDate
                            ? s.startDate.toISOString()
                            : null,
                        createdAt: s.createdAt.toISOString(),
                    },
                ]
            }),
        }
    }
}
