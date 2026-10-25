// True for an absolute http(s) URL. Anything else (javascript:, data:, a bare
// host) must never be stored or opened from a link in the apps.
export const isHttpUrl = (value: string): boolean => {
    try {
        const u = new URL(value)
        return u.protocol === 'http:' || u.protocol === 'https:'
    } catch {
        return false
    }
}
