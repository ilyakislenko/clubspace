import { Feature, IFeatureHandler } from '@shelfjs/features'

import { ClubLegalService } from '../../domains/billing/services/club-legal.service'
import { PlatformPaymentsService } from '../../domains/billing/services/platform-payments.service'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import { serializePlatformPayment } from './schemas'
import {
    StartWorkspaceBillingCardCheckFeature,
    StartWorkspaceBillingCardCheckFeatureResponse,
} from './workspace-billing-payments.feature'

// «Пробный период с картой»: the owner binds a card on YooKassa's page during
// the trial; the webhook saves it and refunds the check. The card pays the
// first period by itself, so binding it is the owner's first payment for the
// offer (ClubLegalService.acceptByFirstPayment) and is gated like one.
@Feature(StartWorkspaceBillingCardCheckFeature)
export class StartWorkspaceBillingCardCheckHandler
    implements
        IFeatureHandler<
            StartWorkspaceBillingCardCheckFeature,
            StartWorkspaceBillingCardCheckFeatureResponse
        >
{
    constructor(
        private readonly rbac: RbacService,
        private readonly payments: PlatformPaymentsService,
        private readonly legal: ClubLegalService,
    ) {}

    async execute(
        f: StartWorkspaceBillingCardCheckFeature,
    ): Promise<StartWorkspaceBillingCardCheckFeatureResponse> {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            'Привязать карту может только администратор клуба',
        )
        await this.legal.assertPaidActionsAllowed(f.workspaceId)
        const { payment, confirmationUrl } = await this.payments.startCardCheck({
            workspaceId: f.workspaceId,
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
