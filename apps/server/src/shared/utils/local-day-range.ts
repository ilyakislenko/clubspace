import { wallClockToUtc } from '../../features/attendance/attendance-utils'

// Inclusive club-local days (YYYY-MM-DD) as the admin picks them.
export type DayRange = { from?: string; to?: string }

// The calendar day after a YYYY-MM-DD date.
export const nextLocalDay = (date: string): string => {
    const d = new Date(`${date}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 1)
    return d.toISOString().slice(0, 10)
}

// The instants of those days in the club's timezone: from its first moment
// to the last moment before the next day starts. undefined when unbounded.
export const localDayRange = (
    range: DayRange | undefined,
    tz: string,
): { gte?: Date; lte?: Date } | undefined => {
    if (!range?.from && !range?.to) return undefined
    return {
        ...(range.from ? { gte: wallClockToUtc(`${range.from}T00:00`, tz) } : {}),
        ...(range.to
            ? {
                  lte: new Date(
                      wallClockToUtc(`${nextLocalDay(range.to)}T00:00`, tz).getTime() - 1,
                  ),
              }
            : {}),
    }
}
