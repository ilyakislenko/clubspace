// E-mail templates substitute {{vars}} with no escaping, so every user-supplied
// value (names, e-mails, club names) goes through this before it is inserted.
const ENTITIES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
}

export const escapeHtml = (value: string): string =>
    value.replace(/[&<>"']/g, (c) => ENTITIES[c])
