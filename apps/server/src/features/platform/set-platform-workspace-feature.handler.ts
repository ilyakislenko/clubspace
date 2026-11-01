import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { ModuleEntitlementService } from '../../domains/billing/services/module-entitlement.service'
import { PlatformBillingService } from '../../domains/billing/services/platform-billing.service'
import {
    featureFlagSelect,
    toFeatureFlags,
} from '../../domains/workspace/feature-flags'
import { PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { loadPlatformWorkspaceBilling } from './platform-workspace-billing-view'
import {
    SetPlatformWorkspaceFeatureFeature,
    SetPlatformWorkspaceFeatureFeatureResponse,
} from './set-platform-workspace-feature.feature'

// The platform owner flips a club's app-section switch, audited. Videos keep
// the rule the club itself has: on only with the VIDEO module.
@Feature(SetPlatformWorkspaceFeatureFeature)
export class SetPlatformWorkspaceFeatureHandler
    implements
        IFeatureHandler<
            SetPlatformWorkspaceFeatureFeature,
            SetPlatformWorkspaceFeatureFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly billing: PlatformBillingService,
        private readonly modules: ModuleEntitlementService,
    ) {}

    async execute(f: SetPlatformWorkspaceFeatureFeature) {
        assertPlatformAdmin(f.isSuperAdmin)

        const { feature, enabled } = f.payload
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: featureFlagSelect,
        })
        if (!workspace) {
            throw new NotFoundError({ message: 'Клуб не найден' })
        }
        if (feature === 'videos' && enabled) {
            await this.modules.assertEntitled(f.workspaceId, 'VIDEO')
        }

        await this.prisma.workspace.update({
            where: { id: f.workspaceId },
            data: { [`${feature}Enabled`]: enabled },
        })

        await this.audit.record({
            action: 'workspace.forceFeature',
            targetType: 'workspace',
            targetId: f.workspaceId,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: {
                feature,
                from: toFeatureFlags(workspace)[feature],
                to: enabled,
            },
        })

        return loadPlatformWorkspaceBilling(
            { prisma: this.prisma, billing: this.billing, audit: this.audit },
            f.workspaceId,
        )
    }
}
