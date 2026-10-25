import { formatPhone, normalizePhone } from './phone'

describe('normalizePhone', () => {
    it.each([
        ['+7 952 884-94-20', '+79528849420'],
        ['8-952-884-94-20', '+79528849420'],
        ['7 (952) 884 94 20', '+79528849420'],
        ['+375 29 123-45-67', '+375291234567'],
        ['  +79528849420  ', '+79528849420'],
    ])('%s -> %s', (raw, expected) => {
        expect(normalizePhone(raw)).toBe(expected)
    })

    it.each([
        [''],
        ['abc'],
        ['12345'],
        ['952 884-94-20'],
        ['+1234567890123456'],
        ['6 952 884-94-20'],
        ['+8 952 884-94-20'],
        ['+7 952 884-94-20 доб. 12'],
        ['8 952 884-94-20 ДОБ 5'],
        ['+7 952 884-94-20 ext 5'],
        ['+7 952 884-94-20 #12'],
        ['+7 952 884-94-20, 12'],
    ])('rejects %p', (raw) => {
        expect(normalizePhone(raw)).toBeNull()
    })
})

describe('formatPhone', () => {
    it('groups a Russian number', () => {
        expect(formatPhone('+79528849420')).toBe('+7 952 884-94-20')
    })

    it('shows any other shape as stored', () => {
        expect(formatPhone('+375291234567')).toBe('+375291234567')
    })
})
