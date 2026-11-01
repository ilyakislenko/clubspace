import { TZDate } from '@date-fns/tz'

// The cross-club agenda is capped at two weeks: it is a "my week" view, and
// every extra day multiplies the projection across all of the caller's clubs.
export const MAX_AGENDA_DAYS = 14

// Calendar day (yyyy-mm-dd) of an instant as seen in `timezone`.
export const localDateIn = (instant: Date, timezone: string): string => {
    const local = new TZDate(instant.getTime(), timezone)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`
}

// True when the local span [start, end] in `timezone` touches the calendar
// window [from, to] (both yyyy-mm-dd, inclusive).
export const overlapsLocalWindow = (
    p: { start: Date; end: Date; timezone: string },
    from: string,
    to: string,
): boolean =>
    localDateIn(p.start, p.timezone) <= to && localDateIn(p.end, p.timezone) >= from

export const personName = (u: {
    firstname: string | null
    lastname: string | null
    email: string | null
}): string =>
    [u.firstname, u.lastname]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(' ') ||
    u.email ||
    'Участник'

// The caller's live clubs: an ACTIVE membership in an active club whose access
// window has not lapsed (the owner's never lapses).
export const isLiveMembership = (
    m: { accessUntil: Date | null; workspace: { ownerId: string } },
    userId: string,
    now: Date,
): boolean =>
    m.workspace.ownerId === userId || !m.accessUntil || m.accessUntil >= now
