import type { PlatformBillingService } from '../../domains/billing/services/platform-billing.service'
import type { PrismaService } from '../../infrastructure/prisma'
import type { GetWorkspaceOnboardingHelpFeatureResponse } from './onboarding-help.feature'
import { serializeOnboardingHelpRequest, setupFeeState } from './schemas'

export const ONBOARDING_HELP_ADMIN_ONLY = 'Помощь с подключением запрашивает администратор клуба'

// The club's view: its latest request and where the setup fee stands.
export const loadWorkspaceOnboardingHelp = async (
    prisma: PrismaService,
    billing: PlatformBillingService,
    workspaceId: string,
): Promise<GetWorkspaceOnboardingHelpFeatureResponse> => {
    const [row, fee] = await Promise.all([
        prisma.onboardingHelpRequest.findFirst({
            where: { workspaceId },
            orderBy: { createdAt: 'desc' },
            include: { workspace: { select: { name: true } } },
        }),
        billing.getBilling(workspaceId),
    ])
    const setupFee = setupFeeState(fee, billing.pricing.setupFee)
    return {
        request: row ? serializeOnboardingHelpRequest(row, setupFee) : null,
        setupFee,
    }
}
