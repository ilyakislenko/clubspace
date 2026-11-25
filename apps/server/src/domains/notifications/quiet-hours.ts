// Quiet hours: 22:00–09:00 club-local, nothing a person didn't ask for right
// now goes out (club messages, docs/design/2026-11-26-broadcast-and-direct-messages.md;
// the federation hub reuses it). Pure: the caller passes the club's zone.
import { localDateInTz, wallClockToUtc } from '../../features/attendance/attendance-utils'
import { localHourInTz } from '../scheduler/clubs-due'

export const QUIET_START_HOUR = 22
export const QUIET_END_HOUR = 9

export const isQuietHour = (now: Date, tz: string): boolean => {
    const hour = localHourInTz(now, tz)
    return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR
}

// `now` when it is outside quiet hours, else the next 09:00 club-local (the
// same day before 09:00, the next day after 22:00) — a DST change in between
// is handled by wallClockToUtc.
export const nextSendAt = (now: Date, tz: string): Date => {
    if (!isQuietHour(now, tz)) return now
    let day = localDateInTz(now, tz)
    if (localHourInTz(now, tz) >= QUIET_START_HOUR) {
        // The next calendar day: plain date arithmetic, no zone involved.
        const [y, m, d] = day.split('-').map(Number)
        day = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
    }
    return wallClockToUtc(`${day}T${String(QUIET_END_HOUR).padStart(2, '0')}:00`, tz)
}
