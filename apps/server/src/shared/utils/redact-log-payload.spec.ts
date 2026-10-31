import { redactLogPayload } from './redact-log-payload'

describe('redactLogPayload', () => {
    it('masks credentials and contact details', () => {
        expect(
            redactLogPayload({
                code: '123456',
                refreshToken: 'eyJ…',
                accessToken: 'eyJ…',
                token: 'abc',
                password: 'p',
                secret: 's',
                email: 'a@b.com',
                phone: 79991234567,
            }),
        ).toEqual({
            code: '[MASKED]',
            refreshToken: '[MASKED]',
            accessToken: '[MASKED]',
            token: '[MASKED]',
            password: '[MASKED]',
            secret: '[MASKED]',
            email: '[MASKED]',
            phone: '[MASKED]',
        })
    })

    // Allow-list: a field nobody thought about is masked, not logged.
    it('masks free text under an unknown key', () => {
        expect(
            redactLogPayload({ firstname: 'Иван', note: 'травма колена' }),
        ).toEqual({ firstname: '[MASKED]', note: '[MASKED]' })
    })

    it('keeps ids, enum-like strings, numbers, booleans and null', () => {
        expect(
            redactLogPayload({
                id: 'a',
                userId: 'u1',
                groupIds: ['g1', 'g2'],
                status: 'ACTIVE',
                language: 'RU',
                price: 1500,
                sendEmail: false,
                accessUntil: null,
            }),
        ).toEqual({
            id: 'a',
            userId: 'u1',
            groupIds: ['g1', 'g2'],
            status: 'ACTIVE',
            language: 'RU',
            price: 1500,
            sendEmail: false,
            accessUntil: null,
        })
    })

    it('recurses into nested objects and arrays', () => {
        expect(
            redactLogPayload({
                members: [{ userId: 'u1', email: 'x@y.z', lastname: 'Петров' }],
            }),
        ).toEqual({
            members: [
                { userId: 'u1', email: '[MASKED]', lastname: '[MASKED]' },
            ],
        })
    })

    it('stops at a bounded depth', () => {
        expect(
            redactLogPayload({ a: { b: { c: { d: { e: { f: 1 } } } } } }),
        ).toEqual({
            a: { b: { c: { d: { e: '[MASKED]' } } } },
        })
    })

    it('returns an empty object for a missing or non-object body', () => {
        expect(redactLogPayload(undefined)).toEqual({})
        expect(redactLogPayload('raw')).toEqual({})
        expect(redactLogPayload([1, 2])).toEqual({})
    })
})
