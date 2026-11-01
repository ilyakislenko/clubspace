import { Feature, IFeatureHandler } from '@shelfjs/features'

import { ModuleEntitlementService } from '../../domains/billing/services/module-entitlement.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    GetPaymentSettingsFeature,
    GetPaymentSettingsFeatureResponse,
} from './get-payment-settings.feature'
import { loadPaymentSettingsView } from './payment-settings-view'

@Feature(GetPaymentSettingsFeature)
export class GetPaymentSettingsHandler
    implements
        IFeatureHandler<
            GetPaymentSettingsFeature,
            GetPaymentSettingsFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly modules: ModuleEntitlementService,
    ) {}

    async execute(f: GetPaymentSettingsFeature) {
        await assertWorkspaceAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        await this.modules.assertEntitled(f.workspaceId, 'ONLINE_PAYMENTS')
        return loadPaymentSettingsView(this.prisma, f.workspaceId)
    }
}
