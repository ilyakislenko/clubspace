// Pure helpers for the platform console. Kept free of Prisma so they can be
// unit-tested directly (see platform-utils.spec.ts).

// Workspace.key is what the mobile app passes as `workspaceKey` when a member
// signs in, so it has to survive being typed by hand and pasted into a URL:
// lowercase, no spaces, no diacritics.
export const WORKSPACE_KEY_PATTERN = /^[a-z0-9_-]{2,50}$/

const CYRILLIC_MAP: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh',
    з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
    п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c',
    ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu',
    я: 'ya',
}

// Most clubs here are named in Russian ("Академия БЖЖ"). Without this the
// slug of a Cyrillic name is the empty string and every club would collide
// on the same fallback key.
export const transliterate = (input: string): string =>
    input
        .toLowerCase()
        .split('')
        .map((char) => (char in CYRILLIC_MAP ? CYRILLIC_MAP[char] : char))
        .join('')

export const isValidWorkspaceKey = (key: string): boolean =>
    WORKSPACE_KEY_PATTERN.test(key)

// "Академия БЖЖ №1" -> "akademiya_bzhzh_1". Returns '' when the name carries
// no usable characters at all (e.g. "…"), which the caller must handle —
// silently inventing a key would produce unfindable workspaces.
export const slugifyWorkspaceKey = (name: string): string =>
    transliterate(name.trim())
        // Strip accents: "Académie" -> "academie". ̀-ͯ is the
        // combining-diacritics block NFD splits them into.
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 50)
        // A trailing separator can reappear after the 50-char cut.
        .replace(/_+$/g, '')

// Picks the first free key of the form base, base_2, base_3, … `taken` is the
// set of keys already in the DB that start with `base`. Suffixing rather than
// rejecting keeps "create a second Moscow branch" a one-click action.
export const nextAvailableKey = (
    base: string,
    taken: Iterable<string>,
): string => {
    const used = new Set(taken)
    if (!used.has(base)) return base

    // Bounded so a pathological data set can't spin forever; 1000 clubs
    // sharing one name is a data problem, not something to loop through.
    for (let n = 2; n <= 1000; n += 1) {
        const suffix = `_${n}`
        const candidate = `${base.slice(0, 50 - suffix.length)}${suffix}`
        if (!used.has(candidate)) return candidate
    }
    throw new Error(`No free workspace key for base "${base}"`)
}

// The DB has a unique index on User.email and stores it verbatim, so the
// console must normalise before lookup — otherwise "Ivan@Club.RU" creates a
// second account for someone who already exists as "ivan@club.ru".
export const normalizeEmail = (email: string): string =>
    email.trim().toLowerCase()
