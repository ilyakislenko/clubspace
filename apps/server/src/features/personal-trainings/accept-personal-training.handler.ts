import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    ConflictError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    formatLocalDateTimeRu,
    localDateInTz,
    personalOccurrenceKey,
} from '../attendance/attendance-utils'
import {
    AcceptPersonalTrainingFeature,
    AcceptPersonalTrainingFeatureResponse,
} from './accept-personal-training.feature'
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
import {
    checkAccept,
    noticeRecipients,
} from './personal-training-utils'
import { serializePersonalTraining } from './schemas'

@Feature(AcceptPersonalTrainingFeature)
export class AcceptPersonalTrainingHandler
    implements
        IFeatureHandler<
            AcceptPersonalTrainingFeature,
            AcceptPersonalTrainingFeatureResponse
        >
{
    private readonly logger = new Logger(AcceptPersonalTrainingHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: AcceptPersonalTrainingFeature) {
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
        const option = request.options.find(
            (o) => o.id === f.payload.optionId,
        )
        if (!option) {
            throw new NotFoundError({ message: 'Вариант времени не найден' })
        }
        const now = new Date()
        throwIfRefused(
            checkAccept({
                actor,
                status: request.status,
                option,
                options: request.options,
                now,
            }),
        )

        // The session is created here, not via create-session (coach-only,
        // recomputes kinds). A lost status race throws, which rolls it back.
        await this.prisma.$transaction(async (tx) => {
            const session = await tx.attendanceSession.create({
                data: {
                    workspaceId: f.workspaceId,
                    groupId: null,
                    slotId: null,
                    sessionDate: new Date(
                        `${localDateInTz(option.startAt, request.timezone)}T00:00:00Z`,
                    ),
                    occurrenceKey: personalOccurrenceKey(request.id),
                    title: 'Персональная тренировка',
                    startAt: option.startAt,
                    timezone: request.timezone,
                    checkInCode: null,
                    coachId: request.coachId,
                    createdById: f.invokerUserId,
                    isPersonal: true,
                },
            })
            const moved = await tx.personalTrainingRequest.updateMany({
                where: { id: request.id, status: request.status },
                data: {
                    status: 'CONFIRMED',
                    confirmedStartAt: option.startAt,
                    confirmedDurationMin: option.durationMin,
                    sessionId: session.id,
                },
            })
            if (moved.count === 0) {
                throw new ConflictError({
                    message: 'Статус заявки изменился — обновите экран',
                })
            }
        })

        this.realtime.invalidateUsers(
            [request.memberId, request.coachId],
            ['personal-trainings'],
        )
        const when = formatLocalDateTimeRu(option.startAt, request.timezone)
        await sendPersonalTrainingNotice(this.notifications, this.logger, {
            kind: 'personal.confirmed',
            refBase: `${request.id}:confirmed`,
            recipients: noticeRecipients(
                request.memberId,
                request.coachId,
                f.invokerUserId,
            ),
            workspaceId: f.workspaceId,
            requestId: request.id,
            topic: () => 'Персональная тренировка подтверждена',
            message: (userId) =>
                `${counterpartName(request, userId)} · ${when}${request.gym ? ` · ${request.gym.name}` : ''}`,
        })

        const fresh = await this.prisma.personalTrainingRequest.findUniqueOrThrow(
            { where: { id: request.id }, include: requestInclude },
        )
        return serializePersonalTraining(fresh, now)
    }
}
