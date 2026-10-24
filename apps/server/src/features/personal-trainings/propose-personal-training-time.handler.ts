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
import {
    formatLocalDateTimeRu,
    wallClockToUtc,
} from '../attendance/attendance-utils'
import { displayName } from '../attendance/schemas'
import { sendPersonalTrainingNotice } from './notify-personal-training'
import {
    loadRequestOrThrow,
    requestInclude,
    resolvePersonalTrainingActor,
    throwIfRefused,
} from './personal-training-access'
import {
    checkPropose,
    noticeRecipients,
    validateProposedTimes,
} from './personal-training-utils'
import {
    ProposePersonalTrainingTimeFeature,
    ProposePersonalTrainingTimeFeatureResponse,
} from './propose-personal-training-time.feature'
import { serializePersonalTraining } from './schemas'

@Feature(ProposePersonalTrainingTimeFeature)
export class ProposePersonalTrainingTimeHandler
    implements
        IFeatureHandler<
            ProposePersonalTrainingTimeFeature,
            ProposePersonalTrainingTimeFeatureResponse
        >
{
    private readonly logger = new Logger(
        ProposePersonalTrainingTimeHandler.name,
    )

    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: ProposePersonalTrainingTimeFeature) {
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
        throwIfRefused(checkPropose({ actor, status: request.status }))

        const now = new Date()
        const instant = wallClockToUtc(f.payload.startAt, request.timezone)
        const invalid = validateProposedTimes([instant], now)
        if (invalid) throw new BadRequestError({ message: invalid })

        const option = await this.prisma.$transaction(async (tx) => {
            const created = await tx.personalTrainingOption.create({
                data: {
                    requestId: request.id,
                    startAt: instant,
                    durationMin: f.payload.durationMin,
                    proposedBy: 'coach',
                },
            })
            const moved = await tx.personalTrainingRequest.updateMany({
                where: { id: request.id, status: request.status },
                data: {
                    status: 'PENDING_MEMBER',
                    coachComment: f.payload.comment || null,
                },
            })
            if (moved.count === 0) {
                throw new ConflictError({
                    message: 'Статус заявки изменился — обновите экран',
                })
            }
            return created
        })

        this.realtime.invalidateUsers(
            [request.memberId, request.coachId],
            ['personal-trainings'],
        )
        const when = formatLocalDateTimeRu(instant, request.timezone)
        await sendPersonalTrainingNotice(this.notifications, this.logger, {
            kind: 'personal.proposed',
            refBase: option.id,
            recipients: noticeRecipients(
                request.memberId,
                request.coachId,
                f.invokerUserId,
            ),
            workspaceId: f.workspaceId,
            requestId: request.id,
            topic: () => 'Тренер предложил другое время',
            message: () =>
                `${displayName(request.coach)}: ${when}. Подтвердите или откажитесь в приложении.`,
        })

        const fresh = await this.prisma.personalTrainingRequest.findUniqueOrThrow(
            { where: { id: request.id }, include: requestInclude },
        )
        return serializePersonalTraining(fresh, now)
    }
}
