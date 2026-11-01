import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PlatformBillingService } from '../../domains/billing/services/platform-billing.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import {
    GetPlatformWorkspaceBillingFeature,
    GetPlatformWorkspaceBillingFeatureResponse,
} from './get-platform-workspace-billing.feature'
import { loadPlatformWorkspaceBilling } from './platform-workspace-billing-view'

// The console card of one club (see platform-workspace-billing-view.ts).
@Feature(GetPlatformWorkspaceBillingFeature)
export class GetPlatformWorkspaceBillingHandler
    implements
        IFeatureHandler<
            GetPlatformWorkspaceBillingFeature,
            GetPlatformWorkspaceBillingFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly billing: PlatformBillingService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: GetPlatformWorkspaceBillingFeature) {
        assertPlatformAdmin(f.isSuperAdmin)
        return loadPlatformWorkspaceBilling(
            { prisma: this.prisma, billing: this.billing, audit: this.audit },
            f.workspaceId,
        )
    }
}
