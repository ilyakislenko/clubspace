import { TZDate } from '@date-fns/tz'

// Short self-check-in code a coach reads out to the class. Alphabet excludes
// look-alikes (0/O, 1/I/L) so it's easy to say and type.
const CHECK_IN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const generateCheckInCode = (length = 6): string => {
    let code = ''
    for (let i = 0; i < length; i += 1) {
        code += CHECK_IN_ALPHABET[
            Math.floor(Math.random() * CHECK_IN_ALPHABET.length)
        ]
    }
    return code
}

export const scheduledOccurrenceKey = (slotId: string, sessionDate: string) =>
    `slot:${slotId}:${sessionDate}`
export const adhocOccurrenceKey = (groupId: string, localMinute: string) =>
    `adhoc:${groupId}:${localMinute}`
export const eventOccurrenceKey = (eventId: string) => `event:${eventId}`
export const personalOccurrenceKey = (requestId: string) =>
    `personal:${requestId}`

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

// Where one weekly slot lands on a slot-local calendar date: whether the slot
// runs that day (weekday + effective bounds, the same test as isSlotActiveOn
// minus the exceptions), whether an exception cancels it, and the absolute
// start/end instants in the gym's (or the club's) timezone.
export const resolveSlotOccurrence = (p: {
    slot: {
        id: string
        dayOfWeek: number
        startTime: string
        durationMin: number
        effectiveFrom: Date | null
        effectiveUntil: Date | null
    }
    sessionDate: string // yyyy-mm-dd, slot-local
    gymTz: string | null
    workspaceTz: string
    exceptions: {
        slotId: string | null
        fromDate: Date
        untilDate: Date
        reason: string | null
    }[]
}): {
    scheduled: boolean
    cancelled: boolean
    cancellationReason: string | null
    startAt: Date
    endAt: Date
    timezone: string
} => {
    const { slot } = p
    const date = new Date(`${p.sessionDate}T00:00:00Z`)
    const scheduled =
        slot.dayOfWeek === isoDayOfWeek(date) &&
        !(slot.effectiveFrom && date < slot.effectiveFrom) &&
        !(slot.effectiveUntil && date > slot.effectiveUntil)
    const exception = p.exceptions.find(
        (e) =>
            (e.slotId === null || e.slotId === slot.id) &&
            e.fromDate <= date &&
            e.untilDate >= date,
    )
    const timezone = resolveGroupSessionTz(p.gymTz, p.workspaceTz)
    const startAt = wallClockToUtc(`${p.sessionDate}T${slot.startTime}`, timezone)
    return {
        scheduled,
        cancelled: Boolean(exception),
        cancellationReason: exception?.reason ?? null,
        startAt,
        endAt: new Date(startAt.getTime() + slot.durationMin * 60_000),
        timezone,
    }
}

// "31.10 в 19:00" — the wall-clock of an instant in `tz`, for notification copy.
export const formatLocalDateTimeRu = (instant: Date, tz: string): string => {
    const local = localMinuteInTz(instant, tz)
    return `${local.slice(8, 10)}.${local.slice(5, 7)} в ${local.slice(11, 16)}`
}

const DAY_MS = 24 * 60 * 60 * 1000

// Resolves an optional [from, to] date-string window into concrete UTC
// bounds, applying a default lookback and enforcing ordering + a max span.
// Pure: returns an error message rather than throwing so the caller owns
// the HTTP error type.
export const resolveDateWindow = (
    fromStr: string | undefined,
    toStr: string | undefined,
    opts: { defaultDays: number; maxDays: number },
): { from: Date; to: Date; error: string | null } => {
    const to = toStr ? new Date(`${toStr}T23:59:59.999Z`) : new Date()
    const from = fromStr
        ? new Date(`${fromStr}T00:00:00Z`)
        : new Date(to.getTime() - opts.defaultDays * DAY_MS)
    if (from > to) {
        return { from, to, error: 'from must be before to' }
    }
    if (to.getTime() - from.getTime() > opts.maxDays * DAY_MS) {
        return {
            from,
            to,
            error: `Date range must be at most ${opts.maxDays} days`,
        }
    }
    return { from, to, error: null }
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
