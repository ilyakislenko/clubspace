import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import {
    formatLocalDateTimeRu,
    wallClockToUtc,
} from '../attendance/attendance-utils'
import { displayName } from '../attendance/schemas'
import { sendPersonalTrainingNotice } from './notify-personal-training'
import {
    loadOfferingCoaches,
    requestInclude,
} from './personal-training-access'
import { pluralRu, validateProposedTimes } from './personal-training-utils'
import {
    RequestPersonalTrainingFeature,
    RequestPersonalTrainingFeatureResponse,
} from './request-personal-training.feature'
import { serializePersonalTraining } from './schemas'

const MAX_OPEN_REQUESTS = 3

@Feature(RequestPersonalTrainingFeature)
export class RequestPersonalTrainingHandler
    implements
        IFeatureHandler<
            RequestPersonalTrainingFeature,
            RequestPersonalTrainingFeatureResponse
        >
{
    private readonly logger = new Logger(RequestPersonalTrainingHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute({
        payload,
        workspaceId,
        invokerUserId,
    }: RequestPersonalTrainingFeature) {
        if (payload.coachId === invokerUserId) {
            throw new BadRequestError({
                message:
                    'Нельзя записаться на персональную тренировку к самому себе',
            })
        }
        const coaches = await loadOfferingCoaches(this.prisma, workspaceId)
        if (!coaches.some((c) => c.userId === payload.coachId)) {
            throw new NotFoundError({
                message: 'Этот тренер сейчас не проводит персональные тренировки',
            })
        }

        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { timezone: true },
        })
        let timezone = workspace?.timezone ?? 'UTC'
        if (payload.gymId) {
            const gym = await this.prisma.gym.findFirst({
                where: { id: payload.gymId, workspaceId },
                select: { timezone: true },
            })
            if (!gym) throw new NotFoundError({ message: 'Зал не найден' })
            timezone = gym.timezone ?? timezone
        }

        // A request whose every option has passed is derived-expired: it must
        // not hold a quota slot (nothing flips its stored status).
        const now = new Date()
        const open = await this.prisma.personalTrainingRequest.count({
            where: {
                workspaceId,
                memberId: invokerUserId,
                status: { in: ['PENDING_COACH', 'PENDING_MEMBER'] },
                options: { some: { startAt: { gt: now } } },
            },
        })
        if (open >= MAX_OPEN_REQUESTS) {
            throw new BadRequestError({
                message: `У вас уже ${MAX_OPEN_REQUESTS} активные заявки — дождитесь ответа или отмените одну из них`,
            })
        }

        const instants = payload.options.map((o) =>
            wallClockToUtc(o.startAt, timezone),
        )
        const invalid = validateProposedTimes(instants, now)
        if (invalid) throw new BadRequestError({ message: invalid })

        const request = await this.prisma.personalTrainingRequest.create({
            data: {
                workspaceId,
                memberId: invokerUserId,
                coachId: payload.coachId,
                gymId: payload.gymId ?? null,
                timezone,
                memberComment: payload.comment || null,
                options: {
                    create: payload.options.map((o, i) => ({
                        startAt: instants[i],
                        durationMin: o.durationMin,
                        proposedBy: 'member',
                    })),
                },
            },
            include: requestInclude,
        })

        this.realtime.invalidateUsers(
            [request.memberId, request.coachId],
            ['personal-trainings'],
        )

        const extra = instants.length - 1
        const more =
            extra > 0
                ? ` и ещё ${extra} ${pluralRu(extra, 'вариант', 'варианта', 'вариантов')}`
                : ''
        await sendPersonalTrainingNotice(this.notifications, this.logger, {
            kind: 'personal.requested',
            refBase: `${request.id}:requested`,
            recipients: [request.coachId],
            workspaceId,
            requestId: request.id,
            topic: () => 'Новая заявка на персональную тренировку',
            message: () =>
                `${displayName(request.member)} предлагает: ${formatLocalDateTimeRu(instants[0], timezone)}${more}`,
        })

        return serializePersonalTraining(request, now)
    }
}
