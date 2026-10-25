import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { SubscriptionFreezeService } from '../../domains/subscriptions/services/subscription-freeze.service'
import { ForbiddenError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    FreezeSubscriptionFeature,
    FreezeSubscriptionFeatureResponse,
} from './freeze-subscription.feature'
import { serializeSubscription, serializeSubscriptionFreeze } from './schemas'

@Feature(FreezeSubscriptionFeature)
export class FreezeSubscriptionHandler
    implements
        IFeatureHandler<
            FreezeSubscriptionFeature,
            FreezeSubscriptionFeatureResponse
        >
{
    constructor(
        private readonly rbac: RbacService,
        private readonly freezes: SubscriptionFreezeService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: FreezeSubscriptionFeature) {
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
                message: 'Нельзя замораживать собственный абонемент',
            })
        }
        await this.rbac.assertCanWriteMember(ctx, f.userId)

        const { freeze, subscription, accessUntil } = await this.freezes.create({
            workspaceId: f.workspaceId,
            userId: f.userId,
            subscriptionId: f.subscriptionId,
            days: f.payload.days,
            fromDate: f.payload.fromDate,
            reason: f.payload.reason,
        })
        const out = serializeSubscriptionFreeze(freeze)

        await this.audit.record({
            action: 'member.freezeSubscription',
            targetType: 'member',
            targetId: f.userId,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: {
                planName: subscription.plan.name,
                fromDate: out.fromDate,
                untilDate: out.untilDate,
                days: out.days,
                reason: out.reason,
            },
        })

        // accessUntil moved too, so refresh the member's own access view as well.
        this.realtime.invalidate(f.workspaceId, [
            'members',
            'subscription',
            'attendance',
        ])

        return {
            freeze: out,
            subscription: serializeSubscription(subscription),
            accessUntil: accessUntil ? accessUntil.toISOString() : null,
        }
    }
}
