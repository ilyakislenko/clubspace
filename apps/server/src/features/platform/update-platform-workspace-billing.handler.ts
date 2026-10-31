import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PlatformBillingService } from '../../domains/billing/services/platform-billing.service'
import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { serializeBillingSummary } from '../workspace-billing/schemas'
import { billingStatusPatch } from './platform-billing-utils'
import {
    UpdatePlatformWorkspaceBillingFeature,
    UpdatePlatformWorkspaceBillingFeatureResponse,
} from './update-platform-workspace-billing.feature'

// Manual billing from the platform console: change plan, extend a trial,
// record a paid period, suspend/resume, keep notes. Every action is audited
// against the club, so it shows in the platform feed and the club's journal.
@Feature(UpdatePlatformWorkspaceBillingFeature)
export class UpdatePlatformWorkspaceBillingHandler
    implements
        IFeatureHandler<
            UpdatePlatformWorkspaceBillingFeature,
            UpdatePlatformWorkspaceBillingFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly billing: PlatformBillingService,
    ) {}

    async execute(f: UpdatePlatformWorkspaceBillingFeature) {
        assertPlatformAdmin(f.isSuperAdmin)

        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { id: true },
        })
        if (!workspace) {
            throw new NotFoundError({ message: 'Клуб не найден' })
        }

        const current = await this.billing.getBilling(f.workspaceId)
        const { kind } = f.payload

        let data: Record<string, unknown>
        if (kind === 'changePlan') {
            const plan = await this.prisma.platformPlan.findUnique({
                where: { id: f.payload.planId },
                select: { id: true },
            })
            if (!plan) {
                throw new NotFoundError({ message: 'Тариф не найден' })
            }
            data = { planId: plan.id }
        } else if (kind === 'setNotes') {
            data = { notes: f.payload.notes?.trim() || null }
        } else {
            data = billingStatusPatch(
                kind,
                current,
                new Date(),
                f.payload.days,
            )
        }

        const updated = await this.prisma.workspaceBilling.update({
            where: { workspaceId: f.workspaceId },
            data,
            include: { plan: true },
        })

        await this.audit.record({
            action: 'workspace.billingUpdate',
            targetType: 'workspace',
            targetId: f.workspaceId,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: {
                kind,
                ...(f.payload.days ? { days: f.payload.days } : {}),
                from: { status: current.status, plan: current.plan.code },
                to: { status: updated.status, plan: updated.plan.code },
            },
        })

        const usage = await this.billing.getUsage(f.workspaceId)
        return {
            workspaceId: f.workspaceId,
            billing: serializeBillingSummary(
                updated,
                usage,
                environment.billing.graceDays,
            ),
            notes: updated.notes,
        }
    }
}
