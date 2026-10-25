import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { ymdToDbDate } from '../../domains/subscriptions/freeze-dates'
import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { loadGradingDetail } from './grading-detail'
import { notifyGradingMoved } from './notify-grading-candidate'
import {
    UpdateRankGradingFeature,
    UpdateRankGradingFeatureResponse,
} from './update-rank-grading.feature'

@Feature(UpdateRankGradingFeature)
export class UpdateRankGradingHandler
    implements
        IFeatureHandler<
            UpdateRankGradingFeature,
            UpdateRankGradingFeatureResponse
        >
{
    private readonly logger = new Logger(UpdateRankGradingHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly realtime: RealtimeEmitter,
        private readonly notifications: NotificationProducerService,
    ) {}

    async execute(f: UpdateRankGradingFeature) {
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
            select: { id: true, date: true, feeAmount: true, feeCurrency: true },
        })
        if (!grading) throw new NotFoundError({ message: 'Аттестация не найдена' })

        const p = f.payload
        if (p.gymId) {
            const gym = await this.prisma.gym.findFirst({
                where: { id: p.gymId, workspaceId: f.workspaceId },
                select: { id: true },
            })
            if (!gym) throw new NotFoundError({ message: 'Зал не найден' })
        }

        // The ladder is fixed: candidates and their levels belong to it.
        const feeAmount =
            p.feeAmount !== undefined ? p.feeAmount : grading.feeAmount
        await this.prisma.rankGrading.update({
            where: { id: grading.id },
            data: {
                ...(p.date !== undefined ? { date: ymdToDbDate(p.date) } : {}),
                ...(p.title !== undefined ? { title: p.title } : {}),
                ...(p.gymId !== undefined ? { gymId: p.gymId } : {}),
                ...(p.feeAmount !== undefined || p.feeCurrency !== undefined
                    ? {
                          feeAmount,
                          feeCurrency:
                              feeAmount !== null
                                  ? (p.feeCurrency ??
                                    grading.feeCurrency ??
                                    'RUB').toUpperCase()
                                  : null,
                      }
                    : {}),
            },
        })
        this.realtime.invalidate(f.workspaceId, ['ranks'])

        // A moved date is news for everyone still waiting for the exam.
        if (
            p.date !== undefined &&
            ymdToDbDate(p.date).getTime() !== grading.date.getTime()
        ) {
            const newDate = ymdToDbDate(p.date)
            try {
                const pending = await this.prisma.rankGradingCandidate.findMany({
                    where: { gradingId: grading.id, result: 'PENDING' },
                    select: { userId: true },
                })
                for (const c of pending) {
                    try {
                        await notifyGradingMoved(
                            this.notifications,
                            f.workspaceId,
                            {
                                gradingId: grading.id,
                                userId: c.userId,
                                date: newDate,
                            },
                        )
                    } catch (err) {
                        this.logger.warn(
                            `Grading moved notice for ${c.userId} failed: ${String(err)}`,
                        )
                    }
                }
            } catch (err) {
                this.logger.warn(`Grading moved notices failed: ${String(err)}`)
            }
        }
        const detail = await loadGradingDetail(
            this.prisma,
            f.workspaceId,
            grading.id,
        )
        if (!detail) throw new NotFoundError({ message: 'Аттестация не найдена' })
        return detail
    }
}
