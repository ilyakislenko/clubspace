import { Feature, IFeatureHandler } from '@shelfjs/features'

import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import { assertPlatformAdmin } from '../../shared/access/assert-platform-admin'
import {
    ListPlatformOnboardingRequestsFeature,
    ListPlatformOnboardingRequestsFeatureResponse,
} from './onboarding-help.feature'
import { serializeOnboardingHelpRequest, setupFeeState } from './schemas'

const LIMIT = 200

// The console's queue of «помощь с подключением» requests, newest first, each
// with where the club's setup fee stands (the operator waives it with the
// «без платы за подключение» promo on the club's card).
@Feature(ListPlatformOnboardingRequestsFeature)
export class ListPlatformOnboardingRequestsHandler
    implements
        IFeatureHandler<
            ListPlatformOnboardingRequestsFeature,
            ListPlatformOnboardingRequestsFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: ListPlatformOnboardingRequestsFeature) {
        assertPlatformAdmin(f.isSuperAdmin)
        const rows = await this.prisma.onboardingHelpRequest.findMany({
            where: f.payload.status ? { status: f.payload.status } : {},
            orderBy: { createdAt: 'desc' },
            take: LIMIT,
            include: {
                workspace: {
                    select: {
                        name: true,
                        billing: { select: { setupFeeWaived: true, setupFeePaidAt: true } },
                    },
                },
            },
        })
        const fee = environment.billing.pricing.setupFee
        return {
            data: rows.map((row) =>
                serializeOnboardingHelpRequest(row, setupFeeState(row.workspace.billing, fee)),
            ),
        }
    }
}
