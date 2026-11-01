import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PlatformBillingService } from '../../domains/billing/services/platform-billing.service'
import { PlatformPaymentsService } from '../../domains/billing/services/platform-payments.service'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import { serializeAutopay } from './schemas'
import {
    RemoveWorkspaceBillingCardFeature,
    RemoveWorkspaceBillingCardFeatureResponse,
} from './workspace-billing-payments.feature'

// The club removes its saved card: no more automatic renewals.
@Feature(RemoveWorkspaceBillingCardFeature)
export class RemoveWorkspaceBillingCardHandler
    implements IFeatureHandler<RemoveWorkspaceBillingCardFeature, RemoveWorkspaceBillingCardFeatureResponse>
{
    constructor(
        private readonly rbac: RbacService,
        private readonly payments: PlatformPaymentsService,
        private readonly billing: PlatformBillingService,
    ) {}

    async execute(f: RemoveWorkspaceBillingCardFeature): Promise<RemoveWorkspaceBillingCardFeatureResponse> {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            'Карту клуба удаляет только администратор клуба',
        )
        await this.payments.removePaymentMethod({
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
        })
        const state = await this.billing.getState(f.workspaceId)
        return serializeAutopay(state.row, state.autopayAvailable)
    }
}
