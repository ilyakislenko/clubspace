import { Feature, IFeatureHandler } from '@shelfjs/features'

import { directionRefSelect } from '../../domains/directions/direction-ref'
import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import {
    GetMemberRanksFeature,
    GetMemberRanksFeatureResponse,
} from './get-member-ranks.feature'
import { serializePromotion } from './schemas'

@Feature(GetMemberRanksFeature)
export class GetMemberRanksHandler
    implements
        IFeatureHandler<GetMemberRanksFeature, GetMemberRanksFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: GetMemberRanksFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const directionIds = await this.rbac.assertManagesDirections(ctx)

        const promotions = await this.prisma.rankPromotion.findMany({
            where: {
                workspaceId: f.workspaceId,
                userId: f.userId,
                ...(directionIds
                    ? { ladder: { directionId: { in: directionIds } } }
                    : {}),
            },
            include: {
                level: { select: { name: true, color: true } },
                ladder: {
                    select: { name: true, direction: directionRefSelect },
                },
                awardedBy: {
                    select: { firstname: true, lastname: true, status: true },
                },
            },
            orderBy: { awardedAt: 'desc' },
        })

        const history = promotions.map((p) =>
            serializePromotion(p, p.awardedBy),
        )
        // Current = the newest promotion per ladder (history is newest-first, so
        // the first one seen for a ladder is its latest).
        const seen = new Set<string>()
        const current = history.filter((p) => {
            if (seen.has(p.ladderId)) return false
            seen.add(p.ladderId)
            return true
        })
        return { current, history }
    }
}
