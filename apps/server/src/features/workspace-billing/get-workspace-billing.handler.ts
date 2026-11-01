import { Feature, IFeatureHandler } from '@shelfjs/features'

import { ClubLegalService } from '../../domains/billing/services/club-legal.service'
import { PlatformBillingService } from '../../domains/billing/services/platform-billing.service'
import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { serializeClubLegalStatus } from '../club-legal/schemas'
import {
    GetWorkspaceBillingFeature,
    GetWorkspaceBillingFeatureResponse,
} from './get-workspace-billing.feature'
import { serializeBillingView, serializePlatformTier } from './schemas'

@Feature(GetWorkspaceBillingFeature)
export class GetWorkspaceBillingHandler
    implements
        IFeatureHandler<
            GetWorkspaceBillingFeature,
            GetWorkspaceBillingFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly billing: PlatformBillingService,
        private readonly legal: ClubLegalService,
    ) {}

    async execute(f: GetWorkspaceBillingFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            'Тариф клуба видит только администратор клуба',
        )

        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { id: true },
        })
        if (!workspace) {
            throw new NotFoundError({ message: 'Клуб не найден' })
        }

        const [state, legal] = await Promise.all([
            this.billing.getState(f.workspaceId),
            this.legal.getState(f.workspaceId),
        ])
        const { pricing, graceDays } = environment.billing
        return {
            enabled: this.billing.enabled,
            billing: serializeBillingView(state, graceDays, pricing.setupFee),
            tiers: pricing.tiers.map(serializePlatformTier),
            annualDiscountPercent: pricing.annualDiscountPercent,
            graceDays,
            legal: {
                ...serializeClubLegalStatus(legal),
                canAccept: legal.ownerId === f.invokerUserId,
            },
        }
    }
}
