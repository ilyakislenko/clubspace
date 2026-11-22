jest.mock('../../environments/environment', () => ({
    environment: {
        production: false,
        adminUrl: 'https://admin.example.ru',
        jwt: { refreshTokenTTL: 3600 },
    },
}))

import { environment } from '../../environments/environment'
import {
    deliverSession,
    readRefreshCookie,
    wantsCookieTransport,
} from './refresh-cookie.util'

const ADMIN = 'https://admin.example.ru'

describe('wantsCookieTransport', () => {
    it.each([
        ['cookie', true],
        [' Cookie ', true],
        [['body', 'cookie'], true],
        ['body', false],
        ['', false],
        [undefined, false],
    ])('header %p from the admin → %p', (transport, expected) => {
        expect(
            wantsCookieTransport({
                transport: transport as string | string[] | undefined,
                origin: ADMIN,
            }),
        ).toBe(expected)
    })

    // Same-site neighbours with credentialed CORS must not reach the cookie.
    it.each([
        'https://app.example.ru',
        'https://pwa.example.ru',
        'http://admin.example.ru',
        'https://admin.example.ru.evil.test',
        undefined,
    ])('refuses Origin %p', (origin) => {
        expect(wantsCookieTransport({ transport: 'cookie', origin })).toBe(false)
    })

    it('accepts ADMIN_URL with a path by its origin', () => {
        const saved = environment.adminUrl
        environment.adminUrl = 'https://admin.example.ru/panel/'
        try {
            expect(wantsCookieTransport({ transport: 'cookie', origin: ADMIN })).toBe(true)
        } finally {
            environment.adminUrl = saved
        }
    })

    it('is off when the admin address is unknown', () => {
        const saved = environment.adminUrl
        environment.adminUrl = null
        try {
            expect(wantsCookieTransport({ transport: 'cookie', origin: ADMIN })).toBe(false)
        } finally {
            environment.adminUrl = saved
        }
    })
})

describe('readRefreshCookie', () => {
    it('finds the refresh cookie among others', () => {
        expect(readRefreshCookie('a=1; cs_refresh=tok.en-1_x; b=2')).toBe(
            'tok.en-1_x',
        )
    })

    it('skips an empty copy and takes the next', () => {
        expect(readRefreshCookie('cs_refresh=; cs_refresh=tok')).toBe('tok')
    })

    it.each([undefined, '', 'other=1', 'cs_refresh_old=tok', 'cs_refresh'])(
        'returns undefined for %p',
        (header) => {
            expect(readRefreshCookie(header)).toBeUndefined()
        },
    )

    it('refuses a malformed escape instead of throwing', () => {
        expect(readRefreshCookie('cs_refresh=%E0%A4%A')).toBeUndefined()
    })
})

describe('deliverSession', () => {
    const session = { userId: 'u1', accessToken: 'a', refreshToken: 'r', expiresAt: 1 }

    it('returns the session untouched in body mode', () => {
        const res = { cookie: jest.fn() }
        expect(
            deliverSession(res as never, { transport: undefined, origin: ADMIN }, session),
        ).toBe(session)
        expect(res.cookie).not.toHaveBeenCalled()
    })

    it('keeps the token in the body for another origin asking for the cookie', () => {
        const res = { cookie: jest.fn() }
        expect(
            deliverSession(
                res as never,
                { transport: 'cookie', origin: 'https://app.example.ru' },
                session,
            ),
        ).toBe(session)
        expect(res.cookie).not.toHaveBeenCalled()
    })

    it('sets the cookie on each auth path and drops the token from the body', () => {
        const res = { cookie: jest.fn() }
        expect(
            deliverSession(res as never, { transport: 'cookie', origin: ADMIN }, session),
        ).toEqual({
            userId: 'u1',
            accessToken: 'a',
            expiresAt: 1,
        })
        expect(res.cookie.mock.calls.map((c) => [c[0], c[1], c[2].path])).toEqual([
            ['cs_refresh', 'r', '/refresh-token'],
            ['cs_refresh', 'r', '/sign-out'],
        ])
        expect(res.cookie.mock.calls[0][2]).toMatchObject({
            httpOnly: true,
            sameSite: 'lax',
            secure: false,
            maxAge: 3_600_000,
        })
    })
})
