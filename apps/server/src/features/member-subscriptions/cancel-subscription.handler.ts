import { Feature, IFeatureHandler } from '@shelfjs/features'

import { SubscriptionService } from '../../domains/subscriptions/services/subscription.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    CancelSubscriptionFeature,
    CancelSubscriptionFeatureResponse,
} from './cancel-subscription.feature'
import { serializeSubscription } from './schemas'

@Feature(CancelSubscriptionFeature)
export class CancelSubscriptionHandler
    implements
        IFeatureHandler<
            CancelSubscriptionFeature,
            CancelSubscriptionFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly subscriptions: SubscriptionService,
    ) {}

    async execute(f: CancelSubscriptionFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            'Only workspace admins can cancel abonements',
        )

        const member = await this.prisma.workspaceMember.findFirst({
            where: { userId: f.userId, workspaceId: f.workspaceId },
            select: { id: true },
        })
        if (!member) throw new NotFoundError({ message: 'Member not found' })

        const sub = await this.prisma.subscription.findFirst({
            where: {
                id: f.subscriptionId,
                workspaceId: f.workspaceId,
                workspaceMemberId: member.id,
            },
            select: { id: true },
        })
        if (!sub) throw new NotFoundError({ message: 'Subscription not found' })

        const updated = await this.subscriptions.cancel({
            workspaceId: f.workspaceId,
            subscriptionId: sub.id,
        })
        return serializeSubscription(updated)
    }
}
