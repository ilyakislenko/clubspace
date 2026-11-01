import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { tierFor } from '../../domains/billing/platform-pricing.config'
import { PlatformBillingService } from '../../domains/billing/services/platform-billing.service'
import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { billingStatusPatch, freeUntilPatch } from './platform-billing-utils'
import { loadPlatformWorkspaceBilling } from './platform-workspace-billing-view'
import {
    UpdatePlatformWorkspaceBillingFeature,
    UpdatePlatformWorkspaceBillingFeatureResponse,
} from './update-platform-workspace-billing.feature'

// Manual billing and overrides from the platform console: extend a trial or a
// period, record a paid period, suspend/resume, notes, a custom monthly price,
// a discount, a free period, the setup fee, monthly vs annual. Every action is
// audited against the club with before/after, so it shows in the platform
// feed, the console card and the club's journal.
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
            select: { id: true, ownerId: true },
        })
        if (!workspace) {
            throw new NotFoundError({ message: 'Клуб не найден' })
        }

        const current = await this.billing.getBilling(f.workspaceId)
        const p = f.payload
        const now = new Date()

        let data: Record<string, unknown>
        switch (p.kind) {
            case 'setNotes':
                data = { notes: p.notes?.trim() || null }
                break
            case 'setCustomPrice':
                data = { customMonthlyPrice: p.customMonthlyPrice ?? null }
                break
            case 'setDiscount':
                data = { discountPercent: p.discountPercent ?? 0 }
                break
            case 'setFreeUntil':
                data = freeUntilPatch(p.freeUntil ?? null, current, now)
                break
            case 'setSetupFeeWaived':
                data = { setupFeeWaived: p.setupFeeWaived ?? false }
                break
            case 'setBillingPeriod':
                data = { billingPeriodMonths: p.billingPeriodMonths ?? 1 }
                break
            case 'markPaid': {
                // The tier this payment is for: the one the club is in now.
                const active = await this.billing.countActiveMembersMany(
                    [workspace],
                    now,
                )
                const { tier } = tierFor(
                    environment.billing.pricing.tiers,
                    active.get(workspace.id) ?? 0,
                )
                data = billingStatusPatch(p.kind, current, now, p.days, tier.code)
                break
            }
            default:
                data = billingStatusPatch(p.kind, current, now, p.days)
        }

        const updated = await this.prisma.workspaceBilling.update({
            where: { workspaceId: f.workspaceId },
            data,
        })

        const changed = Object.keys(data)
        const pick = (row: Record<string, unknown>) =>
            Object.fromEntries(changed.map((k) => [k, row[k] ?? null]))
        await this.audit.record({
            action: 'workspace.billingUpdate',
            targetType: 'workspace',
            targetId: f.workspaceId,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: {
                kind: p.kind,
                ...(p.days ? { days: p.days } : {}),
                from: pick(current),
                to: pick(updated),
            },
        })

        return loadPlatformWorkspaceBilling(
            { prisma: this.prisma, billing: this.billing, audit: this.audit },
            f.workspaceId,
        )
    }
}
