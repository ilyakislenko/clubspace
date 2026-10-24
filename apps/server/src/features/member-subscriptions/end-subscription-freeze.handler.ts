import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { dbDateToYmd } from '../../domains/subscriptions/freeze-dates'
import { SubscriptionFreezeService } from '../../domains/subscriptions/services/subscription-freeze.service'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    EndSubscriptionFreezeFeature,
    EndSubscriptionFreezeFeatureResponse,
} from './end-subscription-freeze.feature'
import { serializeSubscription, serializeSubscriptionFreeze } from './schemas'

@Feature(EndSubscriptionFreezeFeature)
export class EndSubscriptionFreezeHandler
    implements
        IFeatureHandler<
            EndSubscriptionFreezeFeature,
            EndSubscriptionFreezeFeatureResponse
        >
{
    constructor(
        private readonly rbac: RbacService,
        private readonly freezes: SubscriptionFreezeService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: EndSubscriptionFreezeFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            'Снимать заморозку может только администратор клуба',
        )

        const res = await this.freezes.end({
            workspaceId: f.workspaceId,
            userId: f.userId,
            subscriptionId: f.subscriptionId,
            freezeId: f.freezeId,
        })

        await this.audit.record({
            action: res.removed ? 'member.cancelFreeze' : 'member.endFreeze',
            targetType: 'member',
            targetId: f.userId,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: {
                planName: res.subscription.plan.name,
                fromDate: dbDateToYmd(res.original.fromDate),
                untilDate: dbDateToYmd(res.original.untilDate),
                returnedDays: res.returnedDays,
            },
        })

        this.realtime.invalidate(f.workspaceId, ['subscription'])

        return {
            freeze: res.freeze ? serializeSubscriptionFreeze(res.freeze) : null,
            returnedDays: res.returnedDays,
            subscription: serializeSubscription(res.subscription),
            accessUntil: res.accessUntil ? res.accessUntil.toISOString() : null,
        }
    }
}
