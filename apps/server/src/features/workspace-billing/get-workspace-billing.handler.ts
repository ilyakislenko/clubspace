import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PlatformBillingService } from '../../domains/billing/services/platform-billing.service'
import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    GetWorkspaceBillingFeature,
    GetWorkspaceBillingFeatureResponse,
} from './get-workspace-billing.feature'
import { serializeBillingSummary, serializePlatformPlan } from './schemas'

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

        const [row, usage, plans] = await Promise.all([
            this.billing.getBilling(f.workspaceId),
            this.billing.getUsage(f.workspaceId),
            this.billing.listPlans(),
        ])

        return {
            enabled: this.billing.enabled,
            billing: serializeBillingSummary(
                row,
                usage,
                environment.billing.graceDays,
            ),
            plans: plans.map(serializePlatformPlan),
            graceDays: environment.billing.graceDays,
        }
    }
}
