import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PlatformPaymentsService } from '../../domains/billing/services/platform-payments.service'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import { serializePlatformPayment } from './schemas'
import {
    StartWorkspaceBillingCardCheckFeature,
    StartWorkspaceBillingCardCheckFeatureResponse,
} from './workspace-billing-payments.feature'

// «Пробный период с картой»: the owner binds a card on YooKassa's page during
// the trial; the webhook saves it and refunds the check.
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
        const { payment, confirmationUrl } = await this.payments.startCardCheck({
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
        })
        return { payment: serializePlatformPayment(payment), confirmationUrl }
    }
}
