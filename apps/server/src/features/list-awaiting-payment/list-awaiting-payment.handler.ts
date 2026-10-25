import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import { awaitingPaymentWhere } from '../get-workspace-stats/revenue'
import {
    ListAwaitingPaymentFeature,
    ListAwaitingPaymentFeatureResponse,
} from './list-awaiting-payment.feature'

const LIMIT = 200

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

    async execute(f: ListAwaitingPaymentFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            'Смотреть неоплаченные абонементы может только администратор клуба',
        )

        // Same rows as the dashboard receivable.
        const where = awaitingPaymentWhere(f.workspaceId)
        const [total, subs] = await Promise.all([
            this.prisma.subscription.count({ where }),
            this.prisma.subscription.findMany({
                where,
                orderBy: [
                    { startDate: { sort: 'asc', nulls: 'last' } },
                    { createdAt: 'asc' },
                ],
                take: LIMIT,
                select: {
                    id: true,
                    amountPaid: true,
                    currency: true,
                    startDate: true,
                    createdAt: true,
                    plan: { select: { name: true } },
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
                                .trim() || m.user.email,
                        memberPhone: m.user.phone,
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
