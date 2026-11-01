import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PlatformBillingService } from '../../domains/billing/services/platform-billing.service'
import { PlatformPaymentsService } from '../../domains/billing/services/platform-payments.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { loadPlatformWorkspaceBilling } from './platform-workspace-billing-view'
import {
    SetPlatformWorkspaceAutopayFeature,
    SetPlatformWorkspaceAutopayFeatureResponse,
} from './platform-workspace-payments.feature'

// The console switches a club's automatic renewal on or off (audited).
@Feature(SetPlatformWorkspaceAutopayFeature)
export class SetPlatformWorkspaceAutopayHandler
    implements IFeatureHandler<SetPlatformWorkspaceAutopayFeature, SetPlatformWorkspaceAutopayFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly payments: PlatformPaymentsService,
        private readonly billing: PlatformBillingService,
        private readonly audit: AuditService,
    ) {}

    async execute(f: SetPlatformWorkspaceAutopayFeature): Promise<SetPlatformWorkspaceAutopayFeatureResponse> {
        assertPlatformAdmin(f.isSuperAdmin)
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { id: true },
        })
        if (!workspace) throw new NotFoundError({ message: 'Клуб не найден' })
        await this.payments.setAutopay({
            workspaceId: f.workspaceId,
            enabled: f.payload.enabled,
            actorId: f.invokerUserId,
        })
        return loadPlatformWorkspaceBilling(
            { prisma: this.prisma, billing: this.billing, audit: this.audit },
            f.workspaceId,
        )
    }
}
