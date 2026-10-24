import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { ConflictError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    DeclinePersonalTrainingFeature,
    DeclinePersonalTrainingFeatureResponse,
} from './decline-personal-training.feature'
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
import { checkDecline, noticeRecipients } from './personal-training-utils'
import { serializePersonalTraining } from './schemas'

@Feature(DeclinePersonalTrainingFeature)
export class DeclinePersonalTrainingHandler
    implements
        IFeatureHandler<
            DeclinePersonalTrainingFeature,
            DeclinePersonalTrainingFeatureResponse
        >
{
    private readonly logger = new Logger(DeclinePersonalTrainingHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: DeclinePersonalTrainingFeature) {
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
        throwIfRefused(checkDecline({ actor, status: request.status }))

        const comment = f.payload.comment || null
        const moved = await this.prisma.personalTrainingRequest.updateMany({
            where: { id: request.id, status: request.status },
            data: {
                status: 'DECLINED',
                closedByRole: actor,
                closeComment: comment,
            },
        })
        if (moved.count === 0) {
            throw new ConflictError({
                message: 'Статус заявки изменился — обновите экран',
            })
        }

        this.realtime.invalidateUsers(
            [request.memberId, request.coachId],
            ['personal-trainings'],
        )
        await sendPersonalTrainingNotice(this.notifications, this.logger, {
            kind: 'personal.declined',
            refBase: `${request.id}:declined`,
            recipients: noticeRecipients(
                request.memberId,
                request.coachId,
                f.invokerUserId,
            ),
            workspaceId: f.workspaceId,
            requestId: request.id,
            topic: () =>
                actor === 'coach'
                    ? 'Заявка отклонена'
                    : 'Ученик не принял предложенное время',
            message: (userId) =>
                `${counterpartName(request, userId)}${comment ? `: «${comment}»` : ''}`,
        })

        const fresh = await this.prisma.personalTrainingRequest.findUniqueOrThrow(
            { where: { id: request.id }, include: requestInclude },
        )
        return serializePersonalTraining(fresh, new Date())
    }
}
