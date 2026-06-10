// Defense-in-depth guard for rendering user-supplied URLs as <a href=…>.
// The server should already reject non-http(s) schemes at the schema
// layer (see manage-workspace-events feature schemas), but legacy rows
// written before that guard landed may still exist, and any future
// surface that forgets the server-side check is one click away from
// stored XSS via `javascript:` / `data:` URLs. Returning null here lets
// the caller fall back to plain text instead of an active link.
export function safeExternalUrl(
    value: string | null | undefined,
): string | null {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    if (!trimmed) return null
    let url: URL
    try {
        url = new URL(trimmed)
    } catch {
        return null
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return trimmed
}
