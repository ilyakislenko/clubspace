import {
    fullNameWithoutEmail,
    nameOrPlaceholder,
    publicMemberName,
} from './person-name'

describe('publicMemberName', () => {
    it('abbreviates the surname when both parts exist', () => {
        expect(publicMemberName({ firstname: 'Анна', lastname: 'сидорова' })).toBe(
            'Анна С.',
        )
    })

    it('returns a lone first or last name as-is', () => {
        expect(publicMemberName({ firstname: 'Анна', lastname: null })).toBe(
            'Анна',
        )
        expect(publicMemberName({ firstname: null, lastname: 'Петров' })).toBe(
            'Петров',
        )
    })

    it('falls back to a neutral label, never an e-mail', () => {
        expect(publicMemberName({ firstname: ' ', lastname: null })).toBe(
            'Участник',
        )
    })
})

describe('fullNameWithoutEmail', () => {
    it('joins the parts or falls back to the neutral label', () => {
        expect(
            fullNameWithoutEmail({ firstname: 'Иван', lastname: 'Петров' }),
        ).toBe('Иван Петров')
        expect(fullNameWithoutEmail({ firstname: null, lastname: null })).toBe(
            'Участник',
        )
    })
})

describe('nameOrPlaceholder', () => {
    it('joins the parts or says there is no name', () => {
        expect(
            nameOrPlaceholder({ firstname: 'Иван', lastname: 'Петров' }),
        ).toBe('Иван Петров')
        expect(nameOrPlaceholder({ firstname: null, lastname: null })).toBe(
            'без имени',
        )
    })
})
