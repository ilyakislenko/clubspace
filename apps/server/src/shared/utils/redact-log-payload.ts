// Request bodies and query strings go to the logs (and from there to Sentry).
// They carry credentials (codes, refresh tokens), contact details and free
// text about people, so logging is allow-list based: numbers, booleans and
// null pass, and a string passes only under a key known to hold an id or an
// enum-like value. Everything else is replaced, so a new endpoint can't leak
// a new field by default.

const MASK = '[MASKED]'
const MAX_DEPTH = 4

// Explicit deny-list on top of the allow-list: these never pass, whatever
// their shape (e.g. a numeric phone or a boolean-looking token).
const ALWAYS_MASKED = new Set([
    'code',
    'password',
    'secret',
    'token',
    'accessToken',
    'refreshToken',
    'email',
    'phone',
])

const LOGGABLE_STRING_KEYS = new Set([
    'status',
    'role',
    'roleName',
    'kind',
    'type',
    'language',
    'workspaceKey',
    'visibility',
    'audience',
    'sort',
    'order',
    'orderBy',
    'direction',
    'scope',
    'action',
    'timezone',
    'date',
    'startsAt',
    'endsAt',
    'accessUntil',
    'page',
    'limit',
    'cursor',
])

// Ids (`id`, `userId`, `groupIds`, …) are opaque and are what makes a log
// line useful for support.
const isIdKey = (key: string): boolean =>
    key === 'id' || key === 'ids' || /[a-z](Id|Ids)$/.test(key)

const redactValue = (key: string, value: unknown, depth: number): unknown => {
    if (ALWAYS_MASKED.has(key)) return MASK
    if (value === null || value === undefined) return value
    if (typeof value === 'number' || typeof value === 'boolean') return value
    if (typeof value === 'string') {
        return LOGGABLE_STRING_KEYS.has(key) || isIdKey(key) ? value : MASK
    }
    if (depth >= MAX_DEPTH) return MASK
    if (Array.isArray(value)) {
        return value.map((item) => redactValue(key, item, depth + 1))
    }
    if (typeof value === 'object') {
        return redactLogPayload(value as Record<string, unknown>, depth + 1)
    }
    return MASK
}

export const redactLogPayload = (
    payload: unknown,
    depth = 0,
): Record<string, unknown> => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return {}
    }
    return Object.fromEntries(
        Object.entries(payload as Record<string, unknown>).map(
            ([key, value]) => [key, redactValue(key, value, depth)],
        ),
    )
}
