import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { SubscriptionService } from '../../domains/subscriptions/services/subscription.service'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import { serializeSubscription } from './schemas'
import {
    UnmarkSubscriptionPaidFeature,
    UnmarkSubscriptionPaidFeatureResponse,
} from './unmark-subscription-paid.feature'

@Feature(UnmarkSubscriptionPaidFeature)
export class UnmarkSubscriptionPaidHandler
    implements
        IFeatureHandler<
            UnmarkSubscriptionPaidFeature,
            UnmarkSubscriptionPaidFeatureResponse
        >
{
    constructor(
        private readonly rbac: RbacService,
        private readonly subscriptions: SubscriptionService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: UnmarkSubscriptionPaidFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            'Отменить отметку оплаты может только администратор клуба',
        )

        const subscription = await this.subscriptions.unmarkPaid({
            workspaceId: f.workspaceId,
            userId: f.userId,
            subscriptionId: f.subscriptionId,
        })

        await this.audit.record({
            action: 'member.unmarkSubscriptionPaid',
            targetType: 'member',
            targetId: f.userId,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: {
                planName: subscription.plan.name,
                amount: subscription.amountPaid,
                currency: subscription.currency,
            },
        })

        this.realtime.invalidate(f.workspaceId, ['members', 'subscription'])

        return { subscription: serializeSubscription(subscription) }
    }
}
