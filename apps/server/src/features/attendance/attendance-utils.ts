import { TZDate } from '@date-fns/tz'

export const scheduledOccurrenceKey = (slotId: string, sessionDate: string) =>
    `slot:${slotId}:${sessionDate}`
export const adhocOccurrenceKey = (groupId: string, localMinute: string) =>
    `adhoc:${groupId}:${localMinute}`
export const eventOccurrenceKey = (eventId: string) => `event:${eventId}`

// yyyy-mm-ddThh:mm as seen in `tz`, floored to the minute. en-CA yields
// zero-padded numeric fields we can reassemble into a fixed-width string.
export const localMinuteInTz = (instant: Date, tz: string): string => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(instant)
    const get = (t: string) => parts.find((p) => p.type === t)!.value
    // Some runtimes render midnight as hour '24'; normalise to '00'.
    const hour = get('hour') === '24' ? '00' : get('hour')
    return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`
}

export const localDateInTz = (instant: Date, tz: string): string =>
    localMinuteInTz(instant, tz).slice(0, 10)

export const resolveGroupSessionTz = (
    gymTz: string | null,
    workspaceTz: string,
): string => gymTz ?? workspaceTz

// ISO 8601 day of week from the date's UTC calendar day: Mon=1..Sun=7.
export const isoDayOfWeek = (date: Date): number => {
    const d = date.getUTCDay() // 0=Sun..6=Sat
    return d === 0 ? 7 : d
}

export const isSlotActiveOn = (
    slot: {
        dayOfWeek: number
        effectiveFrom: Date | null
        effectiveUntil: Date | null
    },
    slotId: string,
    date: Date,
    exceptions: { slotId: string | null; fromDate: Date; untilDate: Date }[],
): boolean => {
    if (slot.dayOfWeek !== isoDayOfWeek(date)) return false
    if (slot.effectiveFrom && date < slot.effectiveFrom) return false
    if (slot.effectiveUntil && date > slot.effectiveUntil) return false
    const cancelled = exceptions.some(
        (e) =>
            (e.slotId === null || e.slotId === slotId) &&
            e.fromDate <= date &&
            e.untilDate >= date,
    )
    return !cancelled
}

// "2026-07-02T19:00" + tz -> absolute UTC instant for that wall-clock in
// that zone. Seconds optional. Lifted from the workspace-event handlers so
// attendance and events compute the same instant for the same wall-clock.
export const wallClockToUtc = (wallClock: string, tz: string): Date => {
    const [datePart, timePart] = wallClock.split('T')
    const [y, mo, d] = datePart.split('-').map((p) => parseInt(p, 10))
    const [h, mi, s] = timePart.split(':').map((p) => parseInt(p, 10))
    return new Date(new TZDate(y, mo - 1, d, h, mi, s ?? 0, tz).getTime())
}

// Validate against the runtime's IANA database. Catches typos like a
// Cyrillic character in "Europe/Mosсow" without shipping a whitelist.
export const isValidIanaTz = (tz: string): boolean => {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz })
        return true
    } catch {
        return false
    }
}
