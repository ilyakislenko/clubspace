import {
    formatJoinCode,
    generateJoinCode,
    JOIN_CODE_ALPHABET,
    JOIN_CODE_LENGTH,
    normalizeJoinCode,
} from './join-code'

describe('generateJoinCode', () => {
    it('makes 8 characters from the unambiguous alphabet', () => {
        for (let i = 0; i < 200; i++) {
            const code = generateJoinCode()
            expect(code).toHaveLength(JOIN_CODE_LENGTH)
            expect([...code].every((c) => JOIN_CODE_ALPHABET.includes(c))).toBe(
                true,
            )
        }
    })

    it('has no look-alike characters in the alphabet', () => {
        expect(JOIN_CODE_ALPHABET).toHaveLength(31)
        for (const bad of '01OIL') {
            expect(JOIN_CODE_ALPHABET).not.toContain(bad)
        }
    })

    it('skips bytes at or above 248 (rejection sampling)', () => {
        // 255 and 248 are skipped; 31 wraps around to the first character.
        // Kept bytes 0, 30, 31, 0, 1, 2, 3, 4 -> 2 Z 2 2 3 4 5 6.
        const bytes = [255, 248, 0, 30, 31, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
        const random = jest.fn().mockReturnValue(Buffer.from(bytes))
        expect(generateJoinCode(random)).toBe('2Z223456')
    })

    it('asks for more bytes when a batch is mostly rejected', () => {
        const rejected = Buffer.alloc(16, 255)
        const good = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 0, 0, 0, 0, 0, 0, 0, 0])
        const random = jest
            .fn()
            .mockReturnValueOnce(rejected)
            .mockReturnValueOnce(good)
        expect(generateJoinCode(random)).toBe('23456789')
        expect(random).toHaveBeenCalledTimes(2)
    })
})

describe('normalizeJoinCode', () => {
    it('uppercases and strips hyphens and whitespace', () => {
        expect(normalizeJoinCode('abcd-2345')).toBe('ABCD2345')
        expect(normalizeJoinCode('  abcd 2345 ')).toBe('ABCD2345')
        expect(normalizeJoinCode('ABCD2345')).toBe('ABCD2345')
    })

    it('maps Cyrillic look-alikes to Latin', () => {
        expect(normalizeJoinCode('уск7-к3рв')).toBe('YCK7K3PB')
        expect(normalizeJoinCode('АВЕК-МНТХ')).toBe('ABEKMHTX')
    })

    it('drops no letter silently: other Cyrillic stays invalid', () => {
        expect(normalizeJoinCode('уск7-к3рг')).toBeNull()
    })

    it('returns null for forbidden characters', () => {
        expect(normalizeJoinCode('ABCD-2340')).toBeNull()
        expect(normalizeJoinCode('ABCD-23O5')).toBeNull()
        expect(normalizeJoinCode('ABCD-2I45')).toBeNull()
        expect(normalizeJoinCode('ABCD-23!5')).toBeNull()
    })

    it('returns null for a wrong length or empty input', () => {
        expect(normalizeJoinCode('ABCD234')).toBeNull()
        expect(normalizeJoinCode('ABCD23456')).toBeNull()
        expect(normalizeJoinCode('')).toBeNull()
        expect(normalizeJoinCode(' - ')).toBeNull()
    })
})

describe('formatJoinCode', () => {
    it('shows the code as XXXX-XXXX', () => {
        expect(formatJoinCode('ABCD2345')).toBe('ABCD-2345')
    })
})
