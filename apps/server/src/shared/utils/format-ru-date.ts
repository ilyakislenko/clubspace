/**
 * Human Russian date for notification copy, e.g. "8 мая". Pass the IANA zone the
 * reader lives in for an instant (access expiry); pass 'UTC' for a `@db.Date`
 * column, which is a calendar day stored at UTC midnight.
 */
export const formatRuDate = (date: Date, timeZone: string): string =>
    new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'long',
        timeZone,
    }).format(date)
