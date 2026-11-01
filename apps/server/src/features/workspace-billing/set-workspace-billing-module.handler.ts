import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PlatformPaymentsService } from '../../domains/billing/services/platform-payments.service'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import { serializePlatformPayment } from './schemas'
import {
    SetWorkspaceBillingModuleFeature,
    SetWorkspaceBillingModuleFeatureResponse,
} from './workspace-billing-payments.feature'

// The club connects or disconnects a paid module itself; the platform's
// overrides win (PlatformPaymentsService.setModule).
@Feature(SetWorkspaceBillingModuleFeature)
export class SetWorkspaceBillingModuleHandler
    implements IFeatureHandler<SetWorkspaceBillingModuleFeature, SetWorkspaceBillingModuleFeatureResponse>
{
    constructor(
        private readonly rbac: RbacService,
        private readonly payments: PlatformPaymentsService,
    ) {}

    async execute(f: SetWorkspaceBillingModuleFeature): Promise<SetWorkspaceBillingModuleFeatureResponse> {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            'Модули клуба подключает только администратор клуба',
        )
        const res = await this.payments.setModule({
            workspaceId: f.workspaceId,
            module: f.payload.module,
            enabled: f.payload.enabled,
            actorId: f.invokerUserId,
        })
        return {
            outcome: res.outcome,
            payment: res.payment ? serializePlatformPayment(res.payment) : null,
            confirmationUrl: res.confirmationUrl,
        }
    }
}
