interface NameParts {
    firstname: string | null
    lastname: string | null
}

// Name for payloads every club member can read: never falls back to the
// e-mail. "Имя Ф." when both parts exist, so the board doesn't publish full
// surnames; a bare first (or last) name as-is; "Участник" for none.
export const publicMemberName = (u: NameParts): string => {
    const first = u.firstname?.trim()
    const last = u.lastname?.trim()
    if (first && last) return `${first} ${last[0].toUpperCase()}.`
    return first || last || 'Участник'
}

// Full name for member-visible labels (announcement author, coach): the
// e-mail is never a fallback.
export const fullNameWithoutEmail = (u: NameParts): string =>
    [u.firstname, u.lastname].filter(Boolean).join(' ').trim() || 'Участник'

// Name for staff-facing error text: "Иван Петров, Анна С." style callers
// join these themselves.
export const nameOrPlaceholder = (u: NameParts): string =>
    [u.firstname, u.lastname].filter(Boolean).join(' ').trim() || 'без имени'
