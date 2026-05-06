// Date arithmetic helpers used by the schedule projection. Anchored to
// UTC so day comparisons and `addDays` increments don't wander across
// local DST boundaries — the schedule range works on calendar dates,
// not absolute instants.

export const parseDateOnly = (s: string): Date => {
    // Accepts YYYY-MM-DD. We anchor to UTC midnight so date math (add
    // days, compare) doesn't drift across local DST. The value here
    // represents a calendar date, not an instant.
    const [y, m, d] = s.split('-').map((p) => parseInt(p, 10))
    return new Date(Date.UTC(y, m - 1, d))
}

export const addDays = (d: Date, n: number): Date =>
    new Date(d.getTime() + n * 86_400_000)

export const daysBetween = (a: Date, b: Date): number =>
    Math.round((b.getTime() - a.getTime()) / 86_400_000)

export const isoDayOfWeek = (d: Date): number => {
    // JS getUTCDay returns 0=Sun..6=Sat; ISO uses 1=Mon..7=Sun.
    const js = d.getUTCDay()
    return js === 0 ? 7 : js
}

export const isoDateString = (d: Date): string => d.toISOString().slice(0, 10)

export const endOfDayUtc = (d: Date): Date =>
    new Date(d.getTime() + 86_400_000 - 1)
