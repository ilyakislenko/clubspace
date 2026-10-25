import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ListRankGradingsFeature,
    ListRankGradingsFeatureResponse,
} from './list-rank-gradings.feature'
import { serializeGradingSummary } from './schemas'

@Feature(ListRankGradingsFeature)
export class ListRankGradingsHandler
    implements
        IFeatureHandler<ListRankGradingsFeature, ListRankGradingsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListRankGradingsFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            'Проводить аттестации может только администратор или главный тренер клуба',
        )
        const rows = await this.prisma.rankGrading.findMany({
            where: {
                workspaceId: f.workspaceId,
                ...(f.payload.ladderId ? { ladderId: f.payload.ladderId } : {}),
            },
            orderBy: { date: 'desc' },
            take: 100,
            include: {
                ladder: { select: { name: true } },
                gym: { select: { id: true, name: true } },
                candidates: { select: { result: true, paidAt: true } },
            },
        })
        return { data: rows.map(serializeGradingSummary) }
    }
}
