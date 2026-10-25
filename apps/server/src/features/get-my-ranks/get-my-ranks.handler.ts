import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { serializePromotion } from '../member-ranks/schemas'
import {
    GetMyRanksFeature,
    GetMyRanksFeatureResponse,
} from './get-my-ranks.feature'

// Member-facing rank read: the current user's rank per ladder + promotion
// history. Same shape as the admin get-member-ranks, minus the admin gate.
@Feature(GetMyRanksFeature)
export class GetMyRanksHandler
    implements IFeatureHandler<GetMyRanksFeature, GetMyRanksFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: GetMyRanksFeature) {
        const promotions = await this.prisma.rankPromotion.findMany({
            where: { workspaceId: f.workspaceId, userId: f.userId },
            include: {
                level: { select: { name: true, color: true } },
                ladder: { select: { name: true } },
                awardedBy: {
                    select: { firstname: true, lastname: true, status: true },
                },
            },
            orderBy: { awardedAt: 'desc' },
        })

        const history = promotions.map((p) =>
            serializePromotion(p, p.awardedBy),
        )
        const seen = new Set<string>()
        const current = history.filter((p) => {
            if (seen.has(p.ladderId)) return false
            seen.add(p.ladderId)
            return true
        })
        return { current, history }
    }
}
