import { Feature, IFeatureHandler } from '@shelfjs/features'

import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
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
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: RemoveRankGradingCandidateFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const candidate = await this.prisma.rankGradingCandidate.findFirst({
            where: {
                id: f.candidateId,
                gradingId: f.gradingId,
                workspaceId: f.workspaceId,
            },
            select: {
                id: true,
                result: true,
                paidAt: true,
                grading: { select: { ladder: { select: { directionId: true } } } },
            },
        })
        if (!candidate) {
            throw new NotFoundError({
                message: 'Кандидат не найден в этой аттестации',
            })
        }
        await this.rbac.assertCanManageDirection(
            ctx,
            candidate.grading.ladder.directionId,
        )
        if (candidate.result === 'PASSED') {
            throw new BadRequestError({
                message: 'Нельзя убрать кандидата, которому уже присвоен ранг',
            })
        }
        if (candidate.paidAt) {
            throw new BadRequestError({
                message: 'Сначала снимите отметки об оплате',
            })
        }
        await this.prisma.rankGradingCandidate.delete({
            where: { id: candidate.id },
        })
        this.realtime.invalidate(f.workspaceId, ['ranks'])
        return { status: 'deleted' as const }
    }
}
