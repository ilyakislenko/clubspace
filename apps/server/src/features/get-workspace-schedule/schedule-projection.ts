import { TZDate } from '@date-fns/tz'

import { addDays, isoDateString, isoDayOfWeek } from './date-utils'

type SlotRow = {
    id: string
    dayOfWeek: number
    startTime: string
    durationMin: number
    effectiveFrom: Date | null
    effectiveUntil: Date | null
}

type ExceptionRow = {
    slotId: string | null
    fromDate: Date
    untilDate: Date
    reason: string | null
}

export type ProjectableGroup = {
    gym: { timezone: string | null } | null
    slots: SlotRow[]
    // Exceptions overlapping the window (the caller filters the query).
    exceptions: ExceptionRow[]
}

export type ProjectedOccurrence<G extends ProjectableGroup> = {
    group: G
    slot: G['slots'][number]
    // Slot-local calendar date, yyyy-mm-dd.
    date: string
    start: Date
    end: Date
    // gym tz when the group's gym has one, else the workspace's.
    timezone: string
    cancelled: boolean
    cancellationReason: string | null
}

// The weekly schedule projected onto concrete occurrences for `dayCount`
// calendar dates starting at `fromDate` (UTC midnight). Slot times are
// wall-clock in the gym's timezone if it has one, else the workspace's, so DST
// never drifts them. An exception covering the date (whole group, or this slot)
// marks the occurrence cancelled; it is still returned so clients can show it
// struck through with the reason. Unsorted.
export const projectGroupOccurrences = <G extends ProjectableGroup>(
    groups: G[],
    fromDate: Date,
    dayCount: number,
    workspaceTimezone: string,
): ProjectedOccurrence<G>[] => {
    const out: ProjectedOccurrence<G>[] = []
    for (let offset = 0; offset < dayCount; offset++) {
        const date = addDays(fromDate, offset)
        const isoDow = isoDayOfWeek(date)
        const dateStr = isoDateString(date)

        for (const group of groups) {
            for (const slot of group.slots) {
                if (slot.dayOfWeek !== isoDow) continue
                if (slot.effectiveFrom && date < slot.effectiveFrom) continue
                if (slot.effectiveUntil && date > slot.effectiveUntil) continue

                const exception = group.exceptions.find(
                    (e) =>
                        (e.slotId === null || e.slotId === slot.id) &&
                        e.fromDate <= date &&
                        e.untilDate >= date,
                )

                const [hour, minute] = slot.startTime
                    .split(':')
                    .map((p) => parseInt(p, 10))
                const timezone = group.gym?.timezone ?? workspaceTimezone
                const start = new Date(
                    new TZDate(
                        date.getUTCFullYear(),
                        date.getUTCMonth(),
                        date.getUTCDate(),
                        hour,
                        minute,
                        timezone,
                    ).getTime(),
                )
                out.push({
                    group,
                    slot,
                    date: dateStr,
                    start,
                    end: new Date(start.getTime() + slot.durationMin * 60_000),
                    timezone,
                    cancelled: Boolean(exception),
                    cancellationReason: exception?.reason ?? null,
                })
            }
        }
    }
    return out
}
