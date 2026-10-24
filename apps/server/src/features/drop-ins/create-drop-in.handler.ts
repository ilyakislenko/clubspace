import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { addDaysYmd } from '../../domains/subscriptions/freeze-dates'
import { findFreezeOn } from '../../domains/subscriptions/services/subscription-freeze.service'
import { isSubscriptionUsable } from '../../domains/subscriptions/subscription-status'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { formatRuDate } from '../../shared/utils/format-ru-date'
import {
    formatLocalDateTimeRu,
    localDateInTz,
    resolveSlotOccurrence,
    scheduledOccurrenceKey,
} from '../attendance/attendance-utils'
import { displayName } from '../attendance/schemas'
import {
    CreateDropInFeature,
    CreateDropInFeatureResponse,
} from './create-drop-in.feature'
import { loadDropInEligibility } from './drop-in-eligibility'
import {
    DROP_IN_BLOCK_MESSAGES,
    DROP_IN_COUNT_REASONS,
    DROP_IN_ENDS_BEFORE_CLASS_MESSAGE,
    DROP_IN_FORBIDDEN_REASONS,
    subscriptionEndsBeforeClass,
    type DropInBlockReason,
} from './drop-in-utils'
import { serializeDropInBooking } from './schemas'

const isP2002 = (e: unknown): boolean =>
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === 'P2002'

// How far ahead a class can be booked.
const BOOKING_HORIZON_DAYS = 30

@Feature(CreateDropInFeature)
export class CreateDropInHandler
    implements IFeatureHandler<CreateDropInFeature, CreateDropInFeatureResponse>
{
    private readonly logger = new Logger(CreateDropInHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    private warn(err: unknown): null {
        this.logger.warn(
            `Drop-in notification failed: ${
                err instanceof Error ? err.message : String(err)
            }`,
        )
        return null
    }

    private blocked(reason: DropInBlockReason) {
        const message = DROP_IN_BLOCK_MESSAGES[reason]
        return DROP_IN_FORBIDDEN_REASONS.has(reason)
            ? new ForbiddenError({ message })
            : new BadRequestError({ message })
    }

    async execute({
        payload,
        workspaceId,
        invokerUserId,
    }: CreateDropInFeature) {
        const now = new Date()
        const eligibility = await loadDropInEligibility(
            this.prisma,
            workspaceId,
            invokerUserId,
            now,
        )
        // Count-based refusals wait until we know the class isn't already
        // booked: re-sending an existing booking must stay a no-op.
        if (eligibility.reason && !DROP_IN_COUNT_REASONS.has(eligibility.reason)) {
            throw this.blocked(eligibility.reason)
        }

        const slot = await this.prisma.groupScheduleSlot.findFirst({
            where: { id: payload.slotId, group: { workspaceId } },
            include: {
                group: {
                    select: {
                        id: true,
                        name: true,
                        gym: {
                            select: {
                                id: true,
                                name: true,
                                address: true,
                                timezone: true,
                            },
                        },
                        coach: {
                            select: {
                                firstname: true,
                                lastname: true,
                                email: true,
                            },
                        },
                        coaches: { select: { userId: true } },
                    },
                },
            },
        })
        if (!slot) throw new NotFoundError({ message: 'Тренировка не найдена' })
        const group = slot.group

        const isCoach = group.coaches.some((c) => c.userId === invokerUserId)
        if (isCoach) {
            throw new BadRequestError({ message: 'Вы тренер этой группы' })
        }
        const inGroup = await this.prisma.groupMember.findFirst({
            where: { groupId: group.id, userId: invokerUserId },
            select: { userId: true },
        })
        if (inGroup) {
            throw new BadRequestError({
                message: 'Это ваша группа — приходите без записи',
            })
        }

        const sessionDate = new Date(`${payload.sessionDate}T00:00:00Z`)
        const exceptions = await this.prisma.scheduleException.findMany({
            where: {
                groupId: group.id,
                fromDate: { lte: sessionDate },
                untilDate: { gte: sessionDate },
            },
            select: {
                slotId: true,
                fromDate: true,
                untilDate: true,
                reason: true,
            },
        })
        const occ = resolveSlotOccurrence({
            slot,
            sessionDate: payload.sessionDate,
            gymTz: group.gym?.timezone ?? null,
            workspaceTz: eligibility.timezone,
            exceptions,
        })
        if (!occ.scheduled) {
            throw new BadRequestError({
                message: 'В эту дату тренировки по расписанию нет',
            })
        }
        if (occ.cancelled) {
            throw new BadRequestError({ message: 'Эта тренировка отменена' })
        }
        if (occ.startAt.getTime() <= now.getTime()) {
            throw new BadRequestError({
                message: 'Запись закрыта — тренировка уже началась',
            })
        }
        if (
            payload.sessionDate >
            addDaysYmd(localDateInTz(now, occ.timezone), BOOKING_HORIZON_DAYS)
        ) {
            throw new BadRequestError({
                message: `Записаться можно не раньше чем за ${BOOKING_HORIZON_DAYS} дней до тренировки`,
            })
        }

        const occurrenceKey = scheduledOccurrenceKey(slot.id, payload.sessionDate)
        const alreadyBooked = eligibility.upcoming.some(
            ({ b }) => b.occurrenceKey === occurrenceKey,
        )
        if (!alreadyBooked) {
            if (eligibility.reason) throw this.blocked(eligibility.reason)
            if (
                subscriptionEndsBeforeClass({
                    subscriptionRequired: eligibility.subscriptionRequired,
                    subscription: eligibility.subscription,
                    startAt: occ.startAt,
                })
            ) {
                throw new BadRequestError({
                    message: DROP_IN_ENDS_BEFORE_CLASS_MESSAGE,
                })
            }
        }

        // A frozen abonement is paused: no booking for a day it covers. Same
        // club-calendar day the check-in and the roster badge use.
        const sub = isSubscriptionUsable(eligibility.subscription, now)
            ? eligibility.subscription
            : null
        if (sub) {
            const frozen = await findFreezeOn(this.prisma, {
                subscriptionId: sub.id,
                dayYmd: localDateInTz(occ.startAt, eligibility.timezone),
            })
            if (frozen) {
                throw new BadRequestError({
                    message: `Абонемент заморожен по ${formatRuDate(frozen.untilDate, 'UTC')} — записаться нельзя`,
                })
            }
        }

        let booking
        try {
            booking = await this.prisma.dropInBooking.create({
                data: {
                    workspaceId,
                    userId: invokerUserId,
                    groupId: group.id,
                    slotId: slot.id,
                    sessionDate,
                    occurrenceKey,
                },
            })
        } catch (e) {
            if (!isP2002(e)) throw e
            // Already booked: return the existing row, notify nobody twice.
            const existing = await this.prisma.dropInBooking.findUniqueOrThrow({
                where: {
                    workspaceId_occurrenceKey_userId: {
                        workspaceId,
                        occurrenceKey,
                        userId: invokerUserId,
                    },
                },
            })
            return serializeDropInBooking({ ...existing, slot, group }, occ)
        }

        this.realtime.invalidate(workspaceId, ['attendance', 'schedule'])
        this.realtime.invalidateUsers([invokerUserId], ['dropins'])

        // Best-effort: the booking is committed, a failed push must not undo it,
        // and one coach's failure must not skip the others.
        const member = await this.prisma.user
            .findUniqueOrThrow({
                where: { id: invokerUserId },
                select: { firstname: true, lastname: true, email: true },
            })
            .catch((err: unknown) => this.warn(err))
        if (member) {
            const when = formatLocalDateTimeRu(occ.startAt, occ.timezone)
            for (const coach of group.coaches) {
                try {
                    await this.notifications.notifyUser({
                        userId: coach.userId,
                        kind: 'dropin.booked',
                        refId: `${booking.id}:${coach.userId}`,
                        topic: 'Гость на тренировке',
                        message: `${displayName(member)} придёт на «${group.name}» ${when}`,
                        metadata: {
                            bookingId: booking.id,
                            groupId: group.id,
                            slotId: slot.id,
                            sessionDate: payload.sessionDate,
                        },
                        workspaceId,
                    })
                } catch (err) {
                    this.warn(err)
                }
            }
        }

        return serializeDropInBooking({ ...booking, slot, group }, occ)
    }
}
