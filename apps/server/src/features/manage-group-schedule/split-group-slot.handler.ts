import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { rekeyOccurrence } from '../../domains/schedule-moves/occurrence-rekey'
import {
    addDaysYmd,
    dbDateToYmd,
    ymdToDbDate,
} from '../../domains/subscriptions/freeze-dates'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    collectMoveRecipients,
    invalidateSchedule,
    loadMoveContext,
    pushScheduleMoved,
} from './schedule-move-shared'
import { serializeSlot } from './schemas'
import {
    classInstants,
    findMergeTarget,
    findSplitConflict,
    isOneOffSlot,
    isoDowOfYmd,
    planExceptionShift,
    planSplit,
    splitMessage,
    validateClassMove,
} from './slot-move-utils'
import {
    SplitGroupSlotFeature,
    SplitGroupSlotFeatureResponse,
} from './split-group-slot.feature'

const ymdOrNull = (ymd: string | null): Date | null =>
    ymd ? ymdToDbDate(ymd) : null

// «Это и все следующие»: the weekly slot moves to the new weekday/time from
// the dragged class on, every later class shifting by the same days. The slot
// is cut when it has earlier classes (they keep the old time), changed in place
// when it has none, or continues a series of the group that ended the week
// before with exactly the new time (undo of a previous split). Bookings,
// guests, rosters, exceptions and moved-off classes from that date on follow.
@Feature(SplitGroupSlotFeature)
export class SplitGroupSlotHandler
    implements
        IFeatureHandler<SplitGroupSlotFeature, SplitGroupSlotFeatureResponse>
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
        invokerUserId,
        invokerRoleName,
        isSuperAdmin,
    }: SplitGroupSlotFeature): Promise<SplitGroupSlotFeatureResponse> {
        const ctx = await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName: invokerRoleName,
            isSuperAdmin,
        })
        await this.rbac.assertCanWriteGroup(ctx, groupId)

        const { group, slot, tz } = await loadMoveContext(this.prisma, {
            workspaceId,
            groupId,
            slotId,
        })
        if (isOneOffSlot(slot)) {
            throw new BadRequestError({
                message: 'Это разовое занятие — перенесите только его',
            })
        }
        const { fromDate, newDate, startTime, durationMin, notify } = payload
        const exceptions = await this.prisma.scheduleException.findMany({
            where: {
                groupId,
                fromDate: { lte: ymdToDbDate(fromDate) },
                untilDate: { gte: ymdToDbDate(fromDate) },
            },
        })
        validateClassMove({
            slot,
            sessionDate: fromDate,
            newDate,
            startTime,
            durationMin,
            exceptions,
            tz,
            now: new Date(),
            refuseMovedAway: false,
        })

        const mergeTarget = findMergeTarget(group.slots, {
            slotId: slot.id,
            newDate,
            startTime,
            durationMin,
            capacity: slot.capacity,
        })
        const plan = planSplit({
            source: slot,
            fromDate,
            newDate,
            merge: mergeTarget !== undefined,
        })
        const from = ymdToDbDate(fromDate)
        if (
            findSplitConflict(group.slots, {
                excludeIds: [
                    slot.id,
                    ...(mergeTarget ? [mergeTarget.id] : []),
                    // Classes moved off this series travel with it.
                    ...group.slots
                        .filter(
                            (s) =>
                                s.movedFromSlotId === slot.id &&
                                s.movedFromDate !== null &&
                                s.movedFromDate >= from,
                        )
                        .map((s) => s.id),
                ],
                newDate,
                targetUntil: plan.targetUntil,
                startTime,
                durationMin,
            })
        ) {
            throw new BadRequestError({
                message: 'В это время у группы уже есть занятие',
            })
        }

        const recipients = notify
            ? await collectMoveRecipients(this.prisma, {
                  workspaceId,
                  group,
                  slotId: slot.id,
                  sessionDate: { gte: from },
                  allMembers: true,
                  actorId: invokerUserId,
              })
            : []

        const dayOfWeek = isoDowOfYmd(newDate)
        const target = await this.prisma.$transaction(async (tx) => {
            const target =
                plan.mode === 'merge' && mergeTarget
                    ? await tx.groupScheduleSlot.update({
                          where: { id: mergeTarget.id },
                          data: { effectiveUntil: ymdOrNull(plan.targetUntil) },
                      })
                    : plan.mode === 'inPlace'
                      ? await tx.groupScheduleSlot.update({
                            where: { id: slot.id },
                            data: {
                                dayOfWeek,
                                startTime,
                                durationMin,
                                effectiveFrom: ymdOrNull(plan.targetFrom),
                                effectiveUntil: ymdOrNull(plan.targetUntil),
                            },
                        })
                      : await tx.groupScheduleSlot.create({
                            data: {
                                groupId,
                                dayOfWeek,
                                startTime,
                                durationMin,
                                capacity: slot.capacity,
                                effectiveFrom: ymdOrNull(plan.targetFrom),
                                effectiveUntil: ymdOrNull(plan.targetUntil),
                            },
                        })
            if (plan.history) {
                await tx.groupScheduleSlot.update({
                    where: { id: slot.id },
                    data: { effectiveUntil: ymdOrNull(plan.sourceUntil) },
                })
            }

            // Every class of this slot from fromDate on that has rows (bookings, guests,
            // a roster, a substitute coach).
            const keyed = { workspaceId, slotId: slot.id, sessionDate: { gte: from } }
            const [classes, guests, rosters, substitutions] = await Promise.all([
                tx.classOccurrence.findMany({
                    where: keyed,
                    select: { sessionDate: true },
                }),
                tx.dropInBooking.findMany({
                    where: keyed,
                    select: { sessionDate: true },
                }),
                tx.attendanceSession.findMany({
                    where: keyed,
                    select: { sessionDate: true },
                }),
                tx.classSubstitution.findMany({
                    where: keyed,
                    select: { sessionDate: true },
                }),
            ])
            const dates = new Set(
                [...classes, ...guests, ...rosters, ...substitutions].flatMap((r) =>
                    r.sessionDate ? [dbDateToYmd(r.sessionDate)] : [],
                ),
            )
            for (const date of [...dates].sort()) {
                const toDate = addDaysYmd(date, plan.delta)
                await rekeyOccurrence(tx, {
                    workspaceId,
                    fromSlotId: slot.id,
                    fromDate: date,
                    toSlotId: target.id,
                    toDate,
                    ...classInstants(toDate, startTime, durationMin, tz),
                })
            }

            const shift = planExceptionShift(
                await tx.scheduleException.findMany({
                    where: { slotId: slot.id, untilDate: { gte: from } },
                }),
                fromDate,
                plan.delta,
            )
            for (const e of shift.repoint) {
                await tx.scheduleException.update({
                    where: { id: e.id },
                    data: {
                        slotId: target.id,
                        fromDate: ymdToDbDate(e.fromDate),
                        untilDate: ymdToDbDate(e.untilDate),
                    },
                })
            }
            for (const e of shift.truncate) {
                await tx.scheduleException.update({
                    where: { id: e.id },
                    data: { untilDate: ymdToDbDate(e.untilDate) },
                })
            }
            for (const e of shift.copies) {
                await tx.scheduleException.create({
                    data: {
                        groupId,
                        slotId: target.id,
                        fromDate: ymdToDbDate(e.fromDate),
                        untilDate: ymdToDbDate(e.untilDate),
                        reason: e.reason,
                        movedToSlotId: e.movedToSlotId,
                    },
                })
            }

            // Classes moved off this series keep pointing at their origin.
            const movedOff = await tx.groupScheduleSlot.findMany({
                where: { movedFromSlotId: slot.id, movedFromDate: { gte: from } },
                select: { id: true, movedFromDate: true },
            })
            for (const m of movedOff) {
                await tx.groupScheduleSlot.update({
                    where: { id: m.id },
                    data: {
                        movedFromSlotId: target.id,
                        movedFromDate: m.movedFromDate
                            ? ymdToDbDate(
                                  addDaysYmd(dbDateToYmd(m.movedFromDate), plan.delta),
                              )
                            : null,
                    },
                })
            }

            if (plan.deleteSource) {
                await tx.groupScheduleSlot.delete({ where: { id: slot.id } })
            }
            return target
        })

        const merged = plan.mode === 'merge'
        await this.audit.record({
            action: 'group.slotSplit',
            targetType: 'group',
            targetId: groupId,
            workspaceId,
            actorId: invokerUserId,
            metadata: {
                slotId: slot.id,
                fromDate,
                targetSlotId: target.id,
                newDate,
                startTime,
                durationMin,
                merged,
                inPlace: plan.mode === 'inPlace',
            },
        })
        invalidateSchedule(this.realtime, workspaceId)
        await pushScheduleMoved(this.notifications, this.realtime, {
            recipients,
            topic: 'Расписание изменилось',
            message: splitMessage(
                group.name,
                newDate,
                { dayOfWeek, startTime, durationMin },
                slot,
            ),
            workspaceId,
            groupId,
            slotId: target.id,
            sessionDate: newDate,
        })

        return {
            slot: serializeSlot(target),
            previousSlotId: plan.history ? slot.id : null,
            merged,
        }
    }
}
