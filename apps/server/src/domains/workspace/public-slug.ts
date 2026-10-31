import { slugifyWorkspaceKey } from '../../features/platform/platform-utils'
import { UnexpectedError } from '../../shared/errors/shared.errors'

// The club's public address, app.<domain>/c/<slug>: 3–64 characters, lowercase
// Latin letters and digits in runs joined by single hyphens — readable aloud,
// safe in a URL without percent-encoding, and never ambiguous about where a
// word ends.
export const PUBLIC_SLUG_MIN = 3
export const PUBLIC_SLUG_MAX = 64
export const PUBLIC_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const isValidPublicSlug = (slug: string): boolean =>
    slug.length >= PUBLIC_SLUG_MIN &&
    slug.length <= PUBLIC_SLUG_MAX &&
    PUBLIC_SLUG_PATTERN.test(slug)

// What a person typed (or what arrived in a URL) → the stored form. Lookups go
// through this too, so /c/Akademiya finds "akademiya".
export const normalizePublicSlug = (raw: string): string =>
    raw.trim().toLowerCase()

// Used when nothing usable is left of the name (e.g. "…"): the store suffixes
// it past collisions like any other base.
export const FALLBACK_PUBLIC_SLUG = 'club'

// "Академия БЖЖ №1" → "akademiya-bzhzh-1". Same transliteration as the club
// key, hyphenated because this one is read by people, not typed into a build.
export const slugifyPublicSlug = (name: string): string => {
    const slug = slugifyWorkspaceKey(name).replace(/_/g, '-')
    return isValidPublicSlug(slug) ? slug : FALLBACK_PUBLIC_SLUG
}

// First free slug of the form base, base-2, base-3, … `taken` holds the slugs
// already in the DB that start with `base`.
export const nextAvailablePublicSlug = (
    base: string,
    taken: Iterable<string>,
): string => {
    const used = new Set(taken)
    if (!used.has(base)) return base
    for (let n = 2; n <= 1000; n += 1) {
        const suffix = `-${n}`
        const head = base
            .slice(0, PUBLIC_SLUG_MAX - suffix.length)
            .replace(/-+$/g, '')
        const candidate = `${head}${suffix}`
        if (!used.has(candidate)) return candidate
    }
    throw new UnexpectedError({
        message: 'Не удалось подобрать адрес страницы — задайте его вручную',
    })
}
