import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import {
    formatLocalDateTimeRu,
    resolveSlotOccurrence,
} from '../attendance/attendance-utils'
import { displayName } from '../attendance/schemas'
import {
    CancelDropInFeature,
    CancelDropInFeatureResponse,
} from './cancel-drop-in.feature'

@Feature(CancelDropInFeature)
export class CancelDropInHandler
    implements IFeatureHandler<CancelDropInFeature, CancelDropInFeatureResponse>
{
    private readonly logger = new Logger(CancelDropInHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute({
        workspaceId,
        bookingId,
        invokerUserId,
    }: CancelDropInFeature) {
        const booking = await this.prisma.dropInBooking.findFirst({
            where: { id: bookingId, workspaceId, userId: invokerUserId },
            include: {
                slot: true,
                group: {
                    select: {
                        name: true,
                        gym: { select: { timezone: true } },
                        coaches: { select: { userId: true } },
                    },
                },
            },
        })
        // Missing or someone else's: already gone, and nothing leaks.
        if (!booking) return { status: 'cancelled' as const }

        const sessionDate = booking.sessionDate.toISOString().slice(0, 10)
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { timezone: true },
        })
        const exceptions = await this.prisma.scheduleException.findMany({
            where: {
                groupId: booking.groupId,
                fromDate: { lte: booking.sessionDate },
                untilDate: { gte: booking.sessionDate },
            },
            select: {
                slotId: true,
                fromDate: true,
                untilDate: true,
                reason: true,
            },
        })
        const occ = resolveSlotOccurrence({
            slot: booking.slot,
            sessionDate,
            gymTz: booking.group.gym?.timezone ?? null,
            workspaceTz: workspace?.timezone ?? 'UTC',
            exceptions,
        })
        const active = occ.scheduled && !occ.cancelled
        const now = new Date()
        if (active && occ.startAt.getTime() <= now.getTime()) {
            throw new BadRequestError({
                message: 'Тренировка уже началась — отменить запись нельзя',
            })
        }

        const deleted = await this.prisma.dropInBooking.deleteMany({
            where: { id: booking.id },
        })
        if (deleted.count !== 1) return { status: 'cancelled' as const }

        this.realtime.invalidate(workspaceId, ['attendance', 'schedule'])
        this.realtime.invalidateUsers([invokerUserId], ['dropins'])

        // A class that no longer runs has nothing to tell the coach about.
        if (active) {
            try {
                const member = await this.prisma.user.findUniqueOrThrow({
                    where: { id: invokerUserId },
                    select: { firstname: true, lastname: true, email: true },
                })
                const when = formatLocalDateTimeRu(occ.startAt, occ.timezone)
                for (const coach of booking.group.coaches) {
                    await this.notifications.notifyUser({
                        userId: coach.userId,
                        kind: 'dropin.cancelled',
                        refId: `${booking.id}:${coach.userId}`,
                        topic: 'Запись гостя отменена',
                        message: `${displayName(member)} не придёт на «${booking.group.name}» ${when}`,
                        metadata: {
                            bookingId: booking.id,
                            groupId: booking.groupId,
                            slotId: booking.slotId,
                            sessionDate,
                        },
                        workspaceId,
                    })
                }
            } catch (err) {
                this.logger.warn(
                    `Drop-in cancel notification failed: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                )
            }
        }

        return { status: 'cancelled' as const }
    }
}
