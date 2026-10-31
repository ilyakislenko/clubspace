import {
    FALLBACK_PUBLIC_SLUG,
    isValidPublicSlug,
    nextAvailablePublicSlug,
    normalizePublicSlug,
    slugifyPublicSlug,
} from './public-slug'

describe('slugifyPublicSlug', () => {
    it('transliterates and hyphenates a Russian club name', () => {
        expect(slugifyPublicSlug('Академия БЖЖ №1')).toBe('akademiya-bzhzh-1')
    })

    it('falls back when nothing usable is left', () => {
        expect(slugifyPublicSlug('…!!!')).toBe(FALLBACK_PUBLIC_SLUG)
    })

    it('falls back when the name is too short for a slug', () => {
        expect(slugifyPublicSlug('Я')).toBe(FALLBACK_PUBLIC_SLUG)
    })
})

describe('isValidPublicSlug', () => {
    it.each(['abc', 'gracie-barra', 'club-2', 'a'.repeat(64)])(
        'accepts %s',
        (slug) => expect(isValidPublicSlug(slug)).toBe(true),
    )

    it.each([
        'ab',
        'a'.repeat(65),
        'Gracie',
        '-gracie',
        'gracie-',
        'gracie--barra',
        'gracie_barra',
        'грэпплинг',
    ])('rejects %s', (slug) => expect(isValidPublicSlug(slug)).toBe(false))
})

describe('normalizePublicSlug', () => {
    it('trims and lowercases', () => {
        expect(normalizePublicSlug('  Gracie-Barra ')).toBe('gracie-barra')
    })
})

describe('nextAvailablePublicSlug', () => {
    it('keeps a free base', () => {
        expect(nextAvailablePublicSlug('club', ['club-2'])).toBe('club')
    })

    it('suffixes past collisions', () => {
        expect(nextAvailablePublicSlug('club', ['club', 'club-2'])).toBe(
            'club-3',
        )
    })

    it('stays within the length limit and never leaves a double hyphen', () => {
        const base = `${'a'.repeat(62)}-b`
        const slug = nextAvailablePublicSlug(base, [base])
        expect(slug.length).toBeLessThanOrEqual(64)
        expect(isValidPublicSlug(slug)).toBe(true)
    })

    it('gives up after a thousand siblings', () => {
        const taken = ['club', ...Array.from({ length: 999 }, (_, i) => `club-${i + 2}`)]
        expect(() => nextAvailablePublicSlug('club', taken)).toThrow()
    })
})
