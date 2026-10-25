import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    ConflictError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { formatLocalDateTimeRu } from '../attendance/attendance-utils'
import {
    CancelPersonalTrainingFeature,
    CancelPersonalTrainingFeatureResponse,
} from './cancel-personal-training.feature'
import {
    counterpartName,
    sendPersonalTrainingNotice,
} from './notify-personal-training'
import {
    loadRequestOrThrow,
    requestInclude,
    resolvePersonalTrainingActor,
    throwIfRefused,
} from './personal-training-access'
import { checkCancel, noticeRecipients } from './personal-training-utils'
import { serializePersonalTraining } from './schemas'

@Feature(CancelPersonalTrainingFeature)
export class CancelPersonalTrainingHandler
    implements
        IFeatureHandler<
            CancelPersonalTrainingFeature,
            CancelPersonalTrainingFeatureResponse
        >
{
    private readonly logger = new Logger(CancelPersonalTrainingHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: CancelPersonalTrainingFeature) {
        const request = await loadRequestOrThrow(
            this.prisma,
            f.workspaceId,
            f.requestId,
        )
        const actor = await resolvePersonalTrainingActor(
            this.rbac,
            f,
            request,
        )
        const oldSessionId =
            request.status === 'CONFIRMED' ? request.sessionId : null
        const hasRecords = oldSessionId
            ? (await this.prisma.attendanceRecord.count({
                  where: { sessionId: oldSessionId },
              })) > 0
            : false
        const now = new Date()
        throwIfRefused(
            checkCancel({
                status: request.status,
                confirmedStartAt: request.confirmedStartAt,
                hasRecords,
                now,
            }),
        )

        const comment = f.payload.comment || null
        await this.prisma.$transaction(async (tx) => {
            // Re-count under the transaction: a mark that landed after the
            // pre-check above must not be wiped along with the session.
            if (
                oldSessionId &&
                (await tx.attendanceRecord.count({
                    where: { sessionId: oldSessionId },
                })) > 0
            ) {
                throw new BadRequestError({
                    message: 'Посещение уже отмечено — отменить нельзя',
                })
            }
            const moved = await tx.personalTrainingRequest.updateMany({
                where: { id: request.id, status: request.status },
                data: {
                    status: 'CANCELLED',
                    closedByRole: actor,
                    closeComment: comment,
                    sessionId: null,
                },
            })
            if (moved.count === 0) {
                throw new ConflictError({
                    message: 'Статус заявки изменился — обновите экран',
                })
            }
            if (oldSessionId) {
                await tx.attendanceSession.deleteMany({
                    where: { id: oldSessionId, isPersonal: true },
                })
            }
        })

        this.realtime.invalidateUsers(
            [request.memberId, request.coachId],
            ['personal-trainings', 'attendance'],
        )
        const at = request.confirmedStartAt ?? request.options[0]?.startAt
        const when = at ? formatLocalDateTimeRu(at, request.timezone) : ''
        await sendPersonalTrainingNotice(this.notifications, this.logger, {
            kind: 'personal.cancelled',
            refBase: `${request.id}:cancelled`,
            recipients: noticeRecipients(
                request.memberId,
                request.coachId,
                f.invokerUserId,
            ),
            workspaceId: f.workspaceId,
            requestId: request.id,
            topic: () => 'Персональная тренировка отменена',
            message: (userId) =>
                `${counterpartName(request, userId)} · ${when}${comment ? ` — «${comment}»` : ''}`,
        })

        const fresh = await this.prisma.personalTrainingRequest.findUniqueOrThrow(
            { where: { id: request.id }, include: requestInclude },
        )
        return serializePersonalTraining(fresh, now)
    }
}
