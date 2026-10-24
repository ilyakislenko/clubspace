import { TZDate } from '@date-fns/tz'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { scheduledOccurrenceKey } from '../attendance/attendance-utils'
import { serializeEvent } from '../manage-workspace-events/schemas'
import {
    addDays,
    daysBetween,
    endOfDayUtc,
    isoDateString,
    isoDayOfWeek,
    parseDateOnly,
} from './date-utils'
import {
    GetWorkspaceScheduleFeature,
    GetWorkspaceScheduleFeatureResponse,
} from './get-workspace-schedule.feature'

const MAX_RANGE_DAYS = 90

@Feature(GetWorkspaceScheduleFeature)
export class GetWorkspaceScheduleHandler
    implements
        IFeatureHandler<
            GetWorkspaceScheduleFeature,
            GetWorkspaceScheduleFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ payload, workspaceId }: GetWorkspaceScheduleFeature) {
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { id: true, timezone: true },
        })
        if (!workspace) {
            throw new NotFoundError({ message: 'Клуб не найден' })
        }
        const tz = workspace.timezone

        const fromDate = parseDateOnly(payload.from)
        const toDate = parseDateOnly(payload.to)
        if (toDate < fromDate) {
            throw new NotFoundError({ message: 'Дата «по» должна быть позже даты «с»' })
        }
        const dayCount = daysBetween(fromDate, toDate) + 1
        if (dayCount > MAX_RANGE_DAYS) {
            throw new NotFoundError({
                message: `Слишком широкий период (максимум ${MAX_RANGE_DAYS} дней)`,
            })
        }

        // Pull groups + their slots and any exception that overlaps the
        // requested window. We fetch all groups workspace-wide because the
        // client surface intentionally shows ALL groups (a student can
        // peek at when other gyms train). Per-row visibility happens at a
        // higher layer if needed.
        const groups = await this.prisma.group.findMany({
            where: { workspaceId },
            include: {
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
                        id: true,
                        email: true,
                        firstname: true,
                        lastname: true,
                    },
                },
                slots: true,
                exceptions: {
                    where: {
                        // Overlap test: keep exceptions that touch the
                        // window at all so per-occurrence checks can find
                        // them without re-querying.
                        fromDate: { lte: toDate },
                        untilDate: { gte: fromDate },
                    },
                },
            },
        })

        const events = await this.prisma.workspaceEvent.findMany({
            where: {
                workspaceId,
                // Same overlap test — events that touch the window count.
                startAt: { lte: endOfDayUtc(toDate) },
                endAt: { gte: fromDate },
            },
            orderBy: { startAt: 'asc' },
            include: {
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
                        id: true,
                        email: true,
                        firstname: true,
                        lastname: true,
                    },
                },
            },
        })

        // Drop-in bookings per occurrence, so the coach sees guests on the row.
        const guestCounts = new Map(
            (
                await this.prisma.dropInBooking.groupBy({
                    by: ['occurrenceKey'],
                    where: {
                        workspaceId,
                        sessionDate: { gte: fromDate, lte: toDate },
                    },
                    _count: { _all: true },
                })
            ).map((g) => [g.occurrenceKey, g._count._all]),
        )

        // Walk every calendar date in the window once. For each date we
        // probe every group's slots; this is O(days × groups × slots)
        // which is fine for the day-count cap above.
        const sessions: GetWorkspaceScheduleFeatureResponse['sessions'] = []
        for (let offset = 0; offset < dayCount; offset++) {
            const date = addDays(fromDate, offset)
            const isoDow = isoDayOfWeek(date)
            const dateStr = isoDateString(date)

            for (const group of groups) {
                for (const slot of group.slots) {
                    if (slot.dayOfWeek !== isoDow) continue
                    if (
                        slot.effectiveFrom &&
                        date < slot.effectiveFrom
                    ) {
                        continue
                    }
                    if (
                        slot.effectiveUntil &&
                        date > slot.effectiveUntil
                    ) {
                        continue
                    }

                    // Check exceptions: any row whose date range covers
                    // `date` AND whose slotId either matches the slot or
                    // is null (= group-wide skip).
                    const matchingException = group.exceptions.find(
                        (e) =>
                            (e.slotId === null || e.slotId === slot.id) &&
                            e.fromDate <= date &&
                            e.untilDate >= date,
                    )

                    const [hour, minute] = slot.startTime
                        .split(':')
                        .map((p) => parseInt(p, 10))

                    // Slot times are wall-clock in the gym's timezone if
                    // the gym has its own (multi-city club case); fall back
                    // to the workspace's tz for unassigned groups or gyms
                    // that haven't picked one. Each session ships its
                    // resolved tz so clients render the same wall-clock
                    // the coach typed.
                    const sessionTz = group.gym?.timezone ?? tz
                    const start = new TZDate(
                        date.getUTCFullYear(),
                        date.getUTCMonth(),
                        date.getUTCDate(),
                        hour,
                        minute,
                        sessionTz,
                    )
                    const end = new Date(
                        start.getTime() + slot.durationMin * 60_000,
                    )

                    sessions.push({
                        occurrenceId: `${slot.id}:${dateStr}`,
                        slotId: slot.id,
                        groupId: group.id,
                        group: {
                            id: group.id,
                            name: group.name,
                            gym: group.gym
                                ? {
                                      id: group.gym.id,
                                      name: group.gym.name,
                                      address: group.gym.address,
                                  }
                                : null,
                            coach: group.coach,
                        },
                        timezone: sessionTz,
                        startAt: new Date(start.getTime()).toISOString(),
                        endAt: end.toISOString(),
                        durationMin: slot.durationMin,
                        dayOfWeek: slot.dayOfWeek,
                        cancelled: Boolean(matchingException),
                        cancellationReason: matchingException?.reason ?? null,
                        bookedGuests:
                            guestCounts.get(
                                scheduledOccurrenceKey(slot.id, dateStr),
                            ) ?? 0,
                    })
                }
            }
        }

        sessions.sort((a, b) =>
            a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0,
        )

        return {
            timezone: tz,
            sessions,
            events: events.map(serializeEvent),
        }
    }
}

// Date helpers moved to ./date-utils for unit-test isolation.
