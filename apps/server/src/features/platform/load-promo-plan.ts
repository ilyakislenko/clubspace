import type { PlatformBillingService } from '../../domains/billing/services/platform-billing.service'
import type { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { promoPresetPlan } from './platform-billing-utils'
import type { PlatformWorkspacePromoInput } from './platform-promo-presets.feature'

// The club's current billing row and VIDEO entitlement, and what the preset
// would write over them — shared by the preview and the apply handlers so
// the operator confirms exactly what gets applied.
export const loadPromoPlan = async (
    deps: { prisma: PrismaService; billing: PlatformBillingService },
    workspaceId: string,
    input: PlatformWorkspacePromoInput,
    now: Date,
) => {
    const workspace = await deps.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { id: true },
    })
    if (!workspace) throw new NotFoundError({ message: 'Клуб не найден' })

    const [current, video] = await Promise.all([
        deps.billing.getBilling(workspaceId),
        deps.prisma.workspaceModuleEntitlement.findFirst({
            where: { workspaceId, module: 'VIDEO' },
            select: { module: true, mode: true, compUntil: true },
        }),
    ])
    const plan = promoPresetPlan(input, current, video, now)
    return { current, video, plan }
}
