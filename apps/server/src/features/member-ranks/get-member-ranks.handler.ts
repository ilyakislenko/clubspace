import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
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
        await assertWorkspaceAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })

        const promotions = await this.prisma.rankPromotion.findMany({
            where: { workspaceId: f.workspaceId, userId: f.userId },
            include: {
                level: { select: { name: true, color: true } },
                ladder: { select: { name: true } },
            },
            orderBy: { awardedAt: 'desc' },
        })

        const history = promotions.map(serializePromotion)
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
