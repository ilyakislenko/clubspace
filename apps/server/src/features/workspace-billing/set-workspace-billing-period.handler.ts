import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PlatformPaymentsService } from '../../domains/billing/services/platform-payments.service'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    SetWorkspaceBillingPeriodFeature,
    SetWorkspaceBillingPeriodFeatureResponse,
} from './workspace-billing-payments.feature'

// Monthly or annual: what the next renewal charges.
@Feature(SetWorkspaceBillingPeriodFeature)
export class SetWorkspaceBillingPeriodHandler
    implements IFeatureHandler<SetWorkspaceBillingPeriodFeature, SetWorkspaceBillingPeriodFeatureResponse>
{
    constructor(
        private readonly rbac: RbacService,
        private readonly payments: PlatformPaymentsService,
    ) {}

    async execute(f: SetWorkspaceBillingPeriodFeature): Promise<SetWorkspaceBillingPeriodFeatureResponse> {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            'Период оплаты меняет только администратор клуба',
        )
        const row = await this.payments.setBillingPeriod({
            workspaceId: f.workspaceId,
            periodMonths: f.payload.periodMonths,
            actorId: f.invokerUserId,
        })
        return { billingPeriodMonths: row.billingPeriodMonths }
    }
}
