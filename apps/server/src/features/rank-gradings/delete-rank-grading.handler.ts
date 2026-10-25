import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { ymdToDbDate } from '../../domains/subscriptions/freeze-dates'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { localDateInTz } from '../attendance/attendance-utils'
import {
    DeleteRankGradingFeature,
    DeleteRankGradingFeatureResponse,
} from './delete-rank-grading.feature'
import { notifyGradingCancelled } from './notify-grading-candidate'

@Feature(DeleteRankGradingFeature)
export class DeleteRankGradingHandler
    implements
        IFeatureHandler<
            DeleteRankGradingFeature,
            DeleteRankGradingFeatureResponse
        >
{
    private readonly logger = new Logger(DeleteRankGradingHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly realtime: RealtimeEmitter,
        private readonly notifications: NotificationProducerService,
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
            select: {
                id: true,
                title: true,
                date: true,
                workspace: { select: { timezone: true } },
            },
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
        // Candidates cascade with the grading, so read who was waiting first.
        const pending = await this.prisma.rankGradingCandidate.findMany({
            where: { gradingId: grading.id, result: 'PENDING' },
            select: { userId: true },
        })
        await this.prisma.rankGrading.delete({ where: { id: grading.id } })
        this.realtime.invalidate(f.workspaceId, ['ranks'])
        // A grading that was already behind us in club time has nothing to cancel.
        const upcoming =
            grading.date >=
            ymdToDbDate(localDateInTz(new Date(), grading.workspace.timezone))
        for (const c of upcoming ? pending : []) {
            try {
                await notifyGradingCancelled(this.notifications, f.workspaceId, {
                    gradingId: grading.id,
                    userId: c.userId,
                    title: grading.title,
                })
            } catch (err) {
                this.logger.warn(
                    `Grading cancelled notice for ${c.userId} failed: ${String(err)}`,
                )
            }
        }
        return { status: 'deleted' as const }
    }
}
