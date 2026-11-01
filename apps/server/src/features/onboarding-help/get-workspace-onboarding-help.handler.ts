import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PlatformBillingService } from '../../domains/billing/services/platform-billing.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    GetWorkspaceOnboardingHelpFeature,
    GetWorkspaceOnboardingHelpFeatureResponse,
} from './onboarding-help.feature'
import { loadWorkspaceOnboardingHelp, ONBOARDING_HELP_ADMIN_ONLY } from './onboarding-help-view'

@Feature(GetWorkspaceOnboardingHelpFeature)
export class GetWorkspaceOnboardingHelpHandler
    implements
        IFeatureHandler<GetWorkspaceOnboardingHelpFeature, GetWorkspaceOnboardingHelpFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly billing: PlatformBillingService,
    ) {}

    async execute(f: GetWorkspaceOnboardingHelpFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            ONBOARDING_HELP_ADMIN_ONLY,
        )
        return loadWorkspaceOnboardingHelp(this.prisma, this.billing, f.workspaceId)
    }
}
