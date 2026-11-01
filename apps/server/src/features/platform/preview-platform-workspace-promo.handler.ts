import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PlatformBillingService } from '../../domains/billing/services/platform-billing.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import { loadPromoPlan } from './load-promo-plan'
import {
    PreviewPlatformWorkspacePromoFeature,
    PreviewPlatformWorkspacePromoFeatureResponse,
} from './platform-promo-presets.feature'

// The next charge before and after a promo preset, so the operator sees what
// confirming it does. Writes nothing.
@Feature(PreviewPlatformWorkspacePromoFeature)
export class PreviewPlatformWorkspacePromoHandler
    implements
        IFeatureHandler<
            PreviewPlatformWorkspacePromoFeature,
            PreviewPlatformWorkspacePromoFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly billing: PlatformBillingService,
    ) {}

    async execute(f: PreviewPlatformWorkspacePromoFeature) {
        assertPlatformAdmin(f.isSuperAdmin)

        const now = new Date()
        const { plan } = await loadPromoPlan(
            { prisma: this.prisma, billing: this.billing },
            f.workspaceId,
            f.payload,
            now,
        )
        const [current, next] = await Promise.all([
            this.billing.previewNextCharge(f.workspaceId, {}, now),
            this.billing.previewNextCharge(
                f.workspaceId,
                {
                    row: plan.billing,
                    modules: plan.module ? [plan.module] : [],
                },
                now,
            ),
        ])
        const iso = (d: Date | null) => d?.toISOString() ?? null
        return {
            summary: plan.summary,
            current: { nextChargeAt: iso(current.nextChargeAt), quote: current.quote },
            next: { nextChargeAt: iso(next.nextChargeAt), quote: next.quote },
        }
    }
}
