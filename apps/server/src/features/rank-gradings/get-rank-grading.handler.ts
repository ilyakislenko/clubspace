import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    GetRankGradingFeature,
    GetRankGradingFeatureResponse,
} from './get-rank-grading.feature'
import { loadGradingDetail } from './grading-detail'

@Feature(GetRankGradingFeature)
export class GetRankGradingHandler
    implements
        IFeatureHandler<GetRankGradingFeature, GetRankGradingFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: GetRankGradingFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const grading = await this.prisma.rankGrading.findFirst({
            where: { id: f.gradingId, workspaceId: f.workspaceId },
            select: { ladder: { select: { directionId: true } } },
        })
        if (!grading) throw new NotFoundError({ message: 'Аттестация не найдена' })
        await this.rbac.assertCanManageDirection(ctx, grading.ladder.directionId)
        const detail = await loadGradingDetail(
            this.prisma,
            f.workspaceId,
            f.gradingId,
        )
        if (!detail) throw new NotFoundError({ message: 'Аттестация не найдена' })
        return detail
    }
}
