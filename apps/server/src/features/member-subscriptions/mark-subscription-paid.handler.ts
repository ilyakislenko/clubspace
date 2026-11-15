import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { saleDiscount } from '../../domains/discounts/discount-rules'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { SubscriptionService } from '../../domains/subscriptions/services/subscription.service'
import { ForbiddenError } from '../../shared/errors/shared.errors'
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
        if (
            !this.rbac.canWriteAllGroups(ctx) &&
            f.userId === f.invokerUserId
        ) {
            throw new ForbiddenError({
                message: 'Нельзя отмечать оплату собственного абонемента',
            })
        }
        await this.rbac.assertCanWriteMember(ctx, f.userId)

        const subscription = await this.subscriptions.markPaid({
            workspaceId: f.workspaceId,
            userId: f.userId,
            subscriptionId: f.subscriptionId,
            amount: f.payload.amount,
            discountId: f.payload.discountId,
            paymentMethod: f.payload.method,
            markedById: f.invokerUserId,
        })
        const { oneOff } = saleDiscount(subscription)
        await this.audit.record({
            action: 'member.markSubscriptionPaid',
            targetType: 'member',
            targetId: f.userId,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: {
                subscriptionId: subscription.id,
                planName: subscription.plan.name,
                amount: subscription.amountPaid,
                currency: subscription.currency,
                method: subscription.paymentMethod,
                listPrice: subscription.listPrice,
                discountId: subscription.discountId,
                discountName: subscription.discountName,
                discountAmount: subscription.discountAmount,
                ...(oneOff > 0 ? { oneOff } : {}),
            },
        })

        // A new row in «Платежи».
        this.realtime.invalidate(f.workspaceId, ['members', 'subscription', 'payments'])

        return { subscription: serializeSubscription(subscription) }
    }
}
