import { Feature, IFeatureHandler } from '@shelfjs/features'
import { z } from 'zod'

import { AuditService } from '../../domains/audit/services/audit.service'
import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { rekeyOccurrence } from '../../domains/schedule-moves/occurrence-rekey'
import { ymdToDbDate } from '../../domains/subscriptions/freeze-dates'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    MoveGroupOccurrenceFeature,
    MoveGroupOccurrenceFeatureResponse,
} from './move-group-occurrence.feature'
import {
    collectMoveRecipients,
    invalidateSchedule,
    loadMoveContext,
    pushScheduleMoved,
} from './schedule-move-shared'
import {
    findMoveConflict,
    isOneOffSlot,
    isoDowOfYmd,
    isRestoreMove,
    moveMessage,
    movedReason,
    validateClassMove,
} from './slot-move-utils'

const IsoDate = z.iso.date()

// «Только это занятие». Three outcomes:
//  - a moved class dragged back onto its origin date and time is restored
//    (the ghost exception and the one-off slot go away);
//  - a one-off slot (moved before, or created as one) moves in place;
//  - a weekly slot's class gets a one-off slot on the new date plus an
//    exception cancelling the original date, pointing at it.
// Everything keyed on the class (bookings, guests, roster) follows it.
@Feature(MoveGroupOccurrenceFeature)
export class MoveGroupOccurrenceHandler
    implements
        IFeatureHandler<
            MoveGroupOccurrenceFeature,
            MoveGroupOccurrenceFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
        private readonly rbac: RbacService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute({
        payload,
        workspaceId,
        groupId,
        slotId,
        sessionDate,
        invokerUserId,
        invokerRoleName,
        isSuperAdmin,
    }: MoveGroupOccurrenceFeature): Promise<MoveGroupOccurrenceFeatureResponse> {
        const ctx = await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName: invokerRoleName,
            isSuperAdmin,
        })
        await this.rbac.assertCanWriteGroup(ctx, groupId)

        if (!IsoDate.safeParse(sessionDate).success) {
            throw new BadRequestError({ message: 'Неверная дата занятия' })
        }
        const { group, slot, tz } = await loadMoveContext(this.prisma, {
            workspaceId,
            groupId,
            slotId,
        })
        const { newDate, startTime, durationMin, notify } = payload
        const [minDate, maxDate] =
            sessionDate < newDate ? [sessionDate, newDate] : [newDate, sessionDate]
        const exceptions = await this.prisma.scheduleException.findMany({
            where: {
                groupId,
                fromDate: { lte: ymdToDbDate(maxDate) },
                untilDate: { gte: ymdToDbDate(minDate) },
            },
        })
        const { originalStart, newStart, newEnd } = validateClassMove({
            slot,
            sessionDate,
            newDate,
            startTime,
            durationMin,
            exceptions,
            tz,
            now: new Date(),
            refuseMovedAway: true,
        })
        if (
            findMoveConflict(group.slots, exceptions, {
                sourceSlotId: slot.id,
                sessionDate,
                newDate,
                startTime,
                durationMin,
            })
        ) {
            throw new BadRequestError({
                message: 'В это время у группы уже есть занятие',
            })
        }

        const origin = group.slots.find((s) => s.id === slot.movedFromSlotId)
        const oneOff = isOneOffSlot(slot)
        const restore =
            oneOff && isRestoreMove(slot, origin, { newDate, startTime, durationMin })

        const recipients = notify
            ? await collectMoveRecipients(this.prisma, {
                  workspaceId,
                  group,
                  slotId: slot.id,
                  sessionDate: ymdToDbDate(sessionDate),
                  allMembers: false,
                  actorId: invokerUserId,
              })
            : []

        const newDay = ymdToDbDate(newDate)
        const rekey = (toSlotId: string) => ({
            workspaceId,
            fromSlotId: slot.id,
            fromDate: sessionDate,
            toSlotId,
            toDate: newDate,
            startAt: newStart,
            endAt: newEnd,
        })
        const targetSlotId = await this.prisma.$transaction(async (tx) => {
            if (restore && origin) {
                await rekeyOccurrence(tx, rekey(origin.id))
                await tx.scheduleException.deleteMany({
                    where: { movedToSlotId: slot.id },
                })
                await tx.groupScheduleSlot.delete({ where: { id: slot.id } })
                return origin.id
            }
            if (oneOff) {
                await tx.groupScheduleSlot.update({
                    where: { id: slot.id },
                    data: {
                        dayOfWeek: isoDowOfYmd(newDate),
                        startTime,
                        durationMin,
                        effectiveFrom: newDay,
                        effectiveUntil: newDay,
                    },
                })
                await rekeyOccurrence(tx, rekey(slot.id))
                await tx.scheduleException.updateMany({
                    where: { movedToSlotId: slot.id },
                    data: { reason: movedReason(newStart, tz) },
                })
                return slot.id
            }
            const created = await tx.groupScheduleSlot.create({
                data: {
                    groupId,
                    dayOfWeek: isoDowOfYmd(newDate),
                    startTime,
                    durationMin,
                    effectiveFrom: newDay,
                    effectiveUntil: newDay,
                    capacity: slot.capacity,
                    movedFromSlotId: slot.id,
                    movedFromDate: ymdToDbDate(sessionDate),
                },
            })
            await tx.scheduleException.create({
                data: {
                    groupId,
                    slotId: slot.id,
                    fromDate: ymdToDbDate(sessionDate),
                    untilDate: ymdToDbDate(sessionDate),
                    reason: movedReason(newStart, tz),
                    movedToSlotId: created.id,
                },
            })
            await rekeyOccurrence(tx, rekey(created.id))
            return created.id
        })

        await this.audit.record({
            action: 'group.occurrenceMove',
            targetType: 'group',
            targetId: groupId,
            workspaceId,
            actorId: invokerUserId,
            metadata: {
                slotId: slot.id,
                sessionDate,
                targetSlotId,
                newDate,
                startTime,
                durationMin,
                restored: restore,
            },
        })
        invalidateSchedule(this.realtime, workspaceId)
        await pushScheduleMoved(this.notifications, this.realtime, {
            recipients,
            topic: 'Занятие перенесено',
            message: moveMessage(group.name, originalStart, newStart, tz),
            workspaceId,
            groupId,
            slotId: targetSlotId,
            sessionDate: newDate,
        })

        return { slotId: targetSlotId, sessionDate: newDate, restored: restore }
    }
}
