import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PlatformPaymentsService } from '../../domains/billing/services/platform-payments.service'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import { serializePlatformPayment } from './schemas'
import {
    GetWorkspaceBillingPaymentFeature,
    GetWorkspaceBillingPaymentFeatureResponse,
} from './workspace-billing-payments.feature'

// One payment of the club, re-read from YooKassa while it is pending — the
// owner is back from the payment page, perhaps before the webhook.
@Feature(GetWorkspaceBillingPaymentFeature)
export class GetWorkspaceBillingPaymentHandler
    implements IFeatureHandler<GetWorkspaceBillingPaymentFeature, GetWorkspaceBillingPaymentFeatureResponse>
{
    constructor(
        private readonly rbac: RbacService,
        private readonly payments: PlatformPaymentsService,
    ) {}

    async execute(f: GetWorkspaceBillingPaymentFeature): Promise<GetWorkspaceBillingPaymentFeatureResponse> {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            'Платежи клуба видит только администратор клуба',
        )
        return serializePlatformPayment(
            await this.payments.refresh(f.workspaceId, f.paymentId),
        )
    }
}
