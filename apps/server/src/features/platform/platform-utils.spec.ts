import {
    isValidWorkspaceKey,
    nextAvailableKey,
    normalizeEmail,
    slugifyWorkspaceKey,
    transliterate,
} from './platform-utils'

describe('transliterate', () => {
    it('maps Cyrillic to Latin', () => {
        expect(transliterate('Академия')).toBe('akademiya')
    })

    it('handles multi-character mappings', () => {
        expect(transliterate('Щука')).toBe('schuka')
    })

    it('drops the silent signs', () => {
        expect(transliterate('подъезд')).toBe('podezd')
    })

    it('leaves Latin untouched', () => {
        expect(transliterate('BJJ Academy')).toBe('bjj academy')
    })
})

describe('slugifyWorkspaceKey', () => {
    it('slugifies a Russian club name', () => {
        expect(slugifyWorkspaceKey('Академия БЖЖ')).toBe('akademiya_bzhzh')
    })

    it('collapses punctuation and runs of separators', () => {
        expect(slugifyWorkspaceKey('Академия БЖЖ №1')).toBe('akademiya_bzhzh_1')
    })

    it('strips accents', () => {
        expect(slugifyWorkspaceKey('Académie Française')).toBe(
            'academie_francaise',
        )
    })

    it('trims leading and trailing separators', () => {
        expect(slugifyWorkspaceKey('  --Gracie Barra--  ')).toBe('gracie_barra')
    })

    // The caller must handle this rather than the helper inventing a key:
    // an auto-generated key nobody can guess makes the club unfindable.
    it('returns an empty string when nothing usable is left', () => {
        expect(slugifyWorkspaceKey('…!!!')).toBe('')
    })

    it('caps at the column length and never ends on a separator', () => {
        const key = slugifyWorkspaceKey('a'.repeat(48) + ' ' + 'b'.repeat(20))
        expect(key.length).toBeLessThanOrEqual(50)
        expect(key.endsWith('_')).toBe(false)
    })
})

describe('isValidWorkspaceKey', () => {
    it.each(['bjj_school', 'gracie-barra', 'ab', 'a1'])('accepts %s', (key) => {
        expect(isValidWorkspaceKey(key)).toBe(true)
    })

    it.each(['a', 'BJJ', 'bjj school', 'академия', 'x'.repeat(51), ''])(
        'rejects %s',
        (key) => {
            expect(isValidWorkspaceKey(key)).toBe(false)
        },
    )
})

describe('nextAvailableKey', () => {
    it('returns the base when it is free', () => {
        expect(nextAvailableKey('bjj', [])).toBe('bjj')
    })

    it('suffixes past a collision', () => {
        expect(nextAvailableKey('bjj', ['bjj'])).toBe('bjj_2')
    })

    it('skips over several taken suffixes', () => {
        expect(nextAvailableKey('bjj', ['bjj', 'bjj_2', 'bjj_3'])).toBe('bjj_4')
    })

    it('keeps the suffixed key inside the column length', () => {
        const base = 'a'.repeat(50)
        const key = nextAvailableKey(base, [base])
        expect(key).toBe(`${'a'.repeat(48)}_2`)
        expect(key.length).toBe(50)
    })
})

describe('normalizeEmail', () => {
    it('lowercases and trims', () => {
        expect(normalizeEmail('  Ivan@Club.RU ')).toBe('ivan@club.ru')
    })
})
