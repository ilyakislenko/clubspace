import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { PlatformBillingService } from '../../domains/billing/services/platform-billing.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import { loadPromoPlan } from './load-promo-plan'
import {
    ApplyPlatformWorkspacePromoFeature,
    ApplyPlatformWorkspacePromoFeatureResponse,
} from './platform-promo-presets.feature'
import { loadPlatformWorkspaceBilling } from './platform-workspace-billing-view'
import { writeModuleEntitlement } from './write-module-entitlement'

// Applies a promo preset from the console card: the same overrides the
// preview showed, audited with before/after against the club.
@Feature(ApplyPlatformWorkspacePromoFeature)
export class ApplyPlatformWorkspacePromoHandler
    implements
        IFeatureHandler<
            ApplyPlatformWorkspacePromoFeature,
            ApplyPlatformWorkspacePromoFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly billing: PlatformBillingService,
    ) {}

    async execute(f: ApplyPlatformWorkspacePromoFeature) {
        assertPlatformAdmin(f.isSuperAdmin)

        const { current, video, plan } = await loadPromoPlan(
            { prisma: this.prisma, billing: this.billing },
            f.workspaceId,
            f.payload,
            new Date(),
        )

        const changed = Object.keys(plan.billing)
        const updated =
            changed.length > 0
                ? await this.prisma.workspaceBilling.update({
                      where: { workspaceId: f.workspaceId },
                      data: plan.billing,
                  })
                : current
        if (plan.module) {
            const { module, ...data } = plan.module
            await writeModuleEntitlement(
                this.prisma,
                { workspaceId: f.workspaceId, module },
                data,
            )
        }

        const pick = (row: Record<string, unknown>) =>
            Object.fromEntries(changed.map((k) => [k, row[k] ?? null]))
        await this.audit.record({
            action: 'workspace.promoApply',
            targetType: 'workspace',
            targetId: f.workspaceId,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: {
                preset: f.payload.preset,
                ...(f.payload.months ? { months: f.payload.months } : {}),
                ...(f.payload.discountPercent
                    ? { discountPercent: f.payload.discountPercent }
                    : {}),
                summary: plan.summary,
                from: pick(current),
                to: pick(updated),
                ...(plan.module
                    ? {
                          module: {
                              code: plan.module.module,
                              from: video
                                  ? {
                                        mode: video.mode,
                                        compUntil:
                                            video.compUntil?.toISOString() ?? null,
                                    }
                                  : { mode: 'DEFAULT' },
                              to: {
                                  mode: plan.module.mode,
                                  compUntil:
                                      plan.module.compUntil?.toISOString() ?? null,
                              },
                          },
                      }
                    : {}),
            },
        })

        return loadPlatformWorkspaceBilling(
            { prisma: this.prisma, billing: this.billing, audit: this.audit },
            f.workspaceId,
        )
    }
}
