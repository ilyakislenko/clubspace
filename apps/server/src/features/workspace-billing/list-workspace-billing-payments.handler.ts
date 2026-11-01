import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PlatformPaymentsService } from '../../domains/billing/services/platform-payments.service'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import { serializePlatformPayment } from './schemas'
import {
    ListWorkspaceBillingPaymentsFeature,
    ListWorkspaceBillingPaymentsFeatureResponse,
} from './workspace-billing-payments.feature'

// The club's payments to ClubSpace, newest first, with the receipt address.
@Feature(ListWorkspaceBillingPaymentsFeature)
export class ListWorkspaceBillingPaymentsHandler
    implements IFeatureHandler<ListWorkspaceBillingPaymentsFeature, ListWorkspaceBillingPaymentsFeatureResponse>
{
    constructor(
        private readonly rbac: RbacService,
        private readonly payments: PlatformPaymentsService,
    ) {}

    async execute(f: ListWorkspaceBillingPaymentsFeature): Promise<ListWorkspaceBillingPaymentsFeatureResponse> {
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
        const rows = await this.payments.list(f.workspaceId)
        return { data: rows.map(serializePlatformPayment) }
    }
}
