import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    RemoveRankGradingCandidateFeature,
    RemoveRankGradingCandidateFeatureResponse,
} from './remove-rank-grading-candidate.feature'

@Feature(RemoveRankGradingCandidateFeature)
export class RemoveRankGradingCandidateHandler
    implements
        IFeatureHandler<
            RemoveRankGradingCandidateFeature,
            RemoveRankGradingCandidateFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: RemoveRankGradingCandidateFeature) {
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
        const candidate = await this.prisma.rankGradingCandidate.findFirst({
            where: {
                id: f.candidateId,
                gradingId: f.gradingId,
                workspaceId: f.workspaceId,
            },
            select: { id: true, result: true },
        })
        if (!candidate) {
            throw new NotFoundError({
                message: 'Кандидат не найден в этой аттестации',
            })
        }
        if (candidate.result === 'PASSED') {
            throw new BadRequestError({
                message: 'Нельзя убрать кандидата, которому уже присвоен ранг',
            })
        }
        await this.prisma.rankGradingCandidate.delete({
            where: { id: candidate.id },
        })
        return { status: 'deleted' as const }
    }
}
