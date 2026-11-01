// Pure helpers shared between create-group-slot and update-group-slot
// handlers. Lifted out of the per-handler files so they can be unit
// tested without bringing the whole Nest module into the test process.

export const parseTimeToMinutes = (hhmm: string): number => {
    const [h, m] = hhmm.split(':').map((part) => parseInt(part, 10))
    return h * 60 + m
}

export type SlotInterval = { startTime: string; durationMin: number }

// Returns true if [aStart, aEnd) overlaps [bStart, bEnd), where the
// times are wall-clock minutes from midnight. End-touch ("19:00–20:00"
// next to "20:00–21:00") is NOT an overlap — the next slot picks up
// exactly when the previous one ends.
export const slotsOverlap = (a: SlotInterval, b: SlotInterval): boolean => {
    const aStart = parseTimeToMinutes(a.startTime)
    const aEnd = aStart + a.durationMin
    const bStart = parseTimeToMinutes(b.startTime)
    const bEnd = bStart + b.durationMin
    return aStart < bEnd && bStart < aEnd
}

export const crossesMidnight = (s: SlotInterval): boolean => {
    return parseTimeToMinutes(s.startTime) + s.durationMin > 24 * 60
}

// Whether two inclusive calendar-date ranges share a day; null = open on that
// side. Two slots on the same weekday and time only clash if their effective
// ranges overlap — a one-off or a series cut at a date does not block the
// other half of the schedule.
export const dateRangesOverlap = (
    aFrom: Date | null,
    aUntil: Date | null,
    bFrom: Date | null,
    bUntil: Date | null,
): boolean =>
    (aUntil === null || bFrom === null || bFrom <= aUntil) &&
    (bUntil === null || aFrom === null || aFrom <= bUntil)
