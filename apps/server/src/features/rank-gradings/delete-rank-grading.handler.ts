import { Feature, IFeatureHandler } from '@shelfjs/features'

import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    DeleteRankGradingFeature,
    DeleteRankGradingFeatureResponse,
} from './delete-rank-grading.feature'

@Feature(DeleteRankGradingFeature)
export class DeleteRankGradingHandler
    implements
        IFeatureHandler<
            DeleteRankGradingFeature,
            DeleteRankGradingFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: DeleteRankGradingFeature) {
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
        const grading = await this.prisma.rankGrading.findFirst({
            where: { id: f.gradingId, workspaceId: f.workspaceId },
            select: { id: true },
        })
        if (!grading) throw new NotFoundError({ message: 'Аттестация не найдена' })

        // A PASSED candidate already has an immutable promotion behind it.
        const passed = await this.prisma.rankGradingCandidate.count({
            where: { gradingId: grading.id, result: 'PASSED' },
        })
        if (passed > 0) {
            throw new BadRequestError({
                message:
                    'Нельзя удалить аттестацию: по ней уже присвоены ранги',
            })
        }
        // Paid fees are money the club has taken: unmark them deliberately
        // before the record that explains them disappears.
        const paid = await this.prisma.rankGradingCandidate.count({
            where: { gradingId: grading.id, paidAt: { not: null } },
        })
        if (paid > 0) {
            throw new BadRequestError({
                message: 'Сначала снимите отметки об оплате',
            })
        }
        // Candidates cascade with the grading.
        await this.prisma.rankGrading.delete({ where: { id: grading.id } })
        this.realtime.invalidate(f.workspaceId, ['ranks'])
        return { status: 'deleted' as const }
    }
}
