import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { scheduledOccurrenceKey } from '../attendance/attendance-utils'
import { activeBookerWhere } from '../attendance/expected-attendees'
import { serializeEvent } from '../manage-workspace-events/schemas'
import { daysBetween, endOfDayUtc, parseDateOnly } from './date-utils'
import {
    GetWorkspaceScheduleFeature,
    GetWorkspaceScheduleFeatureResponse,
} from './get-workspace-schedule.feature'
import { projectGroupOccurrences } from './schedule-projection'

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
        // Same eligibility as the roster's expected[]: active club member who
        // is not already in the class's own group.
        const bookings = await this.prisma.dropInBooking.findMany({
            where: {
                workspaceId,
                sessionDate: { gte: fromDate, lte: toDate },
                user: activeBookerWhere(workspaceId),
            },
            select: { occurrenceKey: true, groupId: true, userId: true },
        })
        const ownGroupMembers = bookings.length
            ? await this.prisma.groupMember.findMany({
                  where: {
                      groupId: { in: [...new Set(bookings.map((b) => b.groupId))] },
                      userId: { in: [...new Set(bookings.map((b) => b.userId))] },
                  },
                  select: { groupId: true, userId: true },
              })
            : []
        const isOwnMember = new Set(
            ownGroupMembers.map((m) => `${m.groupId}:${m.userId}`),
        )
        const guestCounts = new Map<string, number>()
        for (const b of bookings) {
            if (isOwnMember.has(`${b.groupId}:${b.userId}`)) continue
            guestCounts.set(
                b.occurrenceKey,
                (guestCounts.get(b.occurrenceKey) ?? 0) + 1,
            )
        }

        const sessions: GetWorkspaceScheduleFeatureResponse['sessions'] =
            projectGroupOccurrences(groups, fromDate, dayCount, tz).map((o) => ({
                occurrenceId: `${o.slot.id}:${o.date}`,
                slotId: o.slot.id,
                groupId: o.group.id,
                group: {
                    id: o.group.id,
                    name: o.group.name,
                    gym: o.group.gym
                        ? {
                              id: o.group.gym.id,
                              name: o.group.gym.name,
                              address: o.group.gym.address,
                          }
                        : null,
                    coach: o.group.coach,
                },
                // Each session ships its resolved tz so clients render the
                // same wall-clock the coach typed.
                timezone: o.timezone,
                startAt: o.start.toISOString(),
                endAt: o.end.toISOString(),
                durationMin: o.slot.durationMin,
                dayOfWeek: o.slot.dayOfWeek,
                cancelled: o.cancelled,
                cancellationReason: o.cancellationReason,
                bookedGuests:
                    guestCounts.get(scheduledOccurrenceKey(o.slot.id, o.date)) ?? 0,
            }))

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
