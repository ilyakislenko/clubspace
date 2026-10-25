import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { SubscriptionService } from '../../domains/subscriptions/services/subscription.service'
import { RbacService } from '../../shared/services/rbac.service'
import {
    MarkSubscriptionPaidFeature,
    MarkSubscriptionPaidFeatureResponse,
} from './mark-subscription-paid.feature'
import { serializeSubscription } from './schemas'

@Feature(MarkSubscriptionPaidFeature)
export class MarkSubscriptionPaidHandler
    implements
        IFeatureHandler<
            MarkSubscriptionPaidFeature,
            MarkSubscriptionPaidFeatureResponse
        >
{
    constructor(
        private readonly rbac: RbacService,
        private readonly subscriptions: SubscriptionService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: MarkSubscriptionPaidFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        await this.rbac.assertCanWriteMember(ctx, f.userId)

        const subscription = await this.subscriptions.markPaid({
            workspaceId: f.workspaceId,
            userId: f.userId,
            subscriptionId: f.subscriptionId,
            amount: f.payload.amount,
        })

        await this.audit.record({
            action: 'member.markSubscriptionPaid',
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
