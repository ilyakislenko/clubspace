import { Feature, IFeatureHandler } from '@shelfjs/features'

import { ClubLegalService } from '../../domains/billing/services/club-legal.service'
import { PlatformPaymentsService } from '../../domains/billing/services/platform-payments.service'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import { serializePlatformPayment } from './schemas'
import {
    StartWorkspaceBillingCheckoutFeature,
    StartWorkspaceBillingCheckoutFeatureResponse,
} from './workspace-billing-payments.feature'

// The club pays its next period by card on YooKassa's page (the card is
// saved for renewals). The period it buys is extended by the webhook. Refused
// once the grace for accepting a new offer edition is over; the owner's first
// payment accepts the current editions.
@Feature(StartWorkspaceBillingCheckoutFeature)
export class StartWorkspaceBillingCheckoutHandler
    implements IFeatureHandler<StartWorkspaceBillingCheckoutFeature, StartWorkspaceBillingCheckoutFeatureResponse>
{
    constructor(
        private readonly rbac: RbacService,
        private readonly payments: PlatformPaymentsService,
        private readonly legal: ClubLegalService,
    ) {}

    async execute(f: StartWorkspaceBillingCheckoutFeature): Promise<StartWorkspaceBillingCheckoutFeatureResponse> {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            'Оплатить тариф может только администратор клуба',
        )
        await this.legal.assertPaidActionsAllowed(f.workspaceId)
        const { payment, confirmationUrl } = await this.payments.startCheckout({
            workspaceId: f.workspaceId,
            periodMonths: f.payload.periodMonths,
            actorId: f.invokerUserId,
        })
        await this.legal.acceptByFirstPayment({
            workspaceId: f.workspaceId,
            userId: f.invokerUserId,
            paymentId: payment.id,
            ip: f.ip,
            userAgent: f.userAgent,
        })
        return { payment: serializePlatformPayment(payment), confirmationUrl }
    }
}
