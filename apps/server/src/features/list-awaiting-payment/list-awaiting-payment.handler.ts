import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import { fullNameWithoutEmail } from '../../shared/utils/person-name'
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

        // An expired debt is still a debt; a cancelled sale is not.
        const subs = await this.prisma.subscription.findMany({
            where: {
                workspaceId: f.workspaceId,
                isPaid: false,
                status: { in: ['ACTIVE', 'EXPIRED'] },
            },
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
                        user: { select: { firstname: true, lastname: true } },
                    },
                },
            },
        })

        return {
            data: subs.flatMap((s) =>
                s.workspaceMember
                    ? [
                          {
                              subscriptionId: s.id,
                              userId: s.workspaceMember.userId,
                              memberName: fullNameWithoutEmail(
                                  s.workspaceMember.user,
                              ),
                              planName: s.plan.name,
                              amount: s.amountPaid,
                              currency: s.currency,
                              startDate: s.startDate
                                  ? s.startDate.toISOString()
                                  : null,
                              createdAt: s.createdAt.toISOString(),
                          },
                      ]
                    : [],
            ),
        }
    }
}
