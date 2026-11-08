jest.mock('../../environments/environment', () => ({
    environment: {
        production: false,
        adminUrl: 'https://admin.example.ru',
        jwt: { refreshTokenTTL: 3600 },
        sentry: {},
    },
}))
jest.mock('../../domains/tokens/services/tokens.service', () => ({
    TokensService: class {},
}))
jest.mock('../../domains/users/services/users.service', () => ({
    UsersService: class {},
}))
jest.mock('../../domains/roles/services/roles.service', () => ({
    RolesService: class {},
}))
jest.mock('../../domains/audit/services/audit.service', () => ({
    AuditService: class {},
}))
jest.mock('../../infrastructure/prisma', () => ({
    PrismaService: class {},
    UserStatus: {},
}))

import { INestApplication } from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { FeaturesBus } from '@shelfjs/features'
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod'
import request from 'supertest'

import { environment } from '../../environments/environment'
import { DefaultErrorFilter } from '../../shared/filters/default-error.filter'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { SignInController } from '../sign-in/sign-in.controller'
import {
    InvalidCredentialsError,
    SignInFeature,
} from '../sign-in/sign-in.feature'
import { SignOutController } from '../sign-out/sign-out.controller'
import { SignOutFeature } from '../sign-out/sign-out.feature'
import { SignOutEverywhereController } from '../sign-out-everywhere/sign-out-everywhere.controller'
import { RefreshTokenController } from './refresh-token.controller'
import { RefreshTokenFeature } from './refresh-token.feature'

const session = (refreshToken: string) => ({
    userId: 'u1',
    accessToken: 'access-1',
    refreshToken,
    expiresAt: 1_900_000_000,
})

const COOKIE_MODE = {
    'X-Token-Transport': 'cookie',
    Origin: 'https://admin.example.ru',
}

// The same-site neighbours CORS_ORIGINS lets in with credentials.
const NEIGHBOURS = ['https://app.example.ru', 'https://pwa.example.ru']

// What the browser is told to store: one HttpOnly cookie per auth path.
const setCookies = (res: request.Response): string[] => {
    const header = res.headers['set-cookie'] as unknown
    return Array.isArray(header) ? header : header ? [String(header)] : []
}

describe('Refresh-token transport over HTTP', () => {
    let app: INestApplication
    const bus = { execute: jest.fn() }

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            controllers: [
                SignInController,
                RefreshTokenController,
                SignOutController,
                SignOutEverywhereController,
            ],
            providers: [
                { provide: FeaturesBus, useValue: bus },
                { provide: APP_PIPE, useClass: ZodValidationPipe },
                { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
                { provide: APP_FILTER, useClass: DefaultErrorFilter },
            ],
        })
            .overrideGuard(AuthGuard)
            .useValue({
                canActivate: (ctx: {
                    switchToHttp: () => { getRequest: () => { user?: unknown } }
                }) => {
                    ctx.switchToHttp().getRequest().user = { userId: 'u1' }
                    return true
                },
            })
            .compile()
        app = moduleRef.createNestApplication()
        await app.init()
    })

    afterAll(async () => {
        await app.close()
    })

    beforeEach(() => {
        bus.execute.mockReset()
        environment.production = false
    })

    describe('POST /sign-in', () => {
        const credentials = { email: 'owner@academy.demo', code: '123456' }

        it('keeps the refresh token in the body without the header', async () => {
            bus.execute.mockResolvedValue(session('rt-1'))
            const res = await request(app.getHttpServer())
                .post('/sign-in')
                .send(credentials)
                .expect(201)

            expect(res.body).toEqual(session('rt-1'))
            expect(setCookies(res)).toEqual([])
        })

        it('moves the refresh token into an HttpOnly cookie in cookie mode', async () => {
            bus.execute.mockResolvedValue(session('rt-1'))
            const res = await request(app.getHttpServer())
                .post('/sign-in')
                .set(COOKIE_MODE)
                .send({ ...credentials, totp: '654321' })
                .expect(201)

            expect(res.body).toEqual({
                userId: 'u1',
                accessToken: 'access-1',
                expiresAt: 1_900_000_000,
            })
            // The TOTP step goes through the same route and transport.
            expect(bus.execute.mock.calls[0][0]).toBeInstanceOf(SignInFeature)
            expect(bus.execute.mock.calls[0][0].payload.totp).toBe('654321')

            const cookies = setCookies(res)
            expect(cookies).toHaveLength(2)
            for (const path of ['/refresh-token', '/sign-out']) {
                const cookie = cookies.find((c) => c.includes(`Path=${path};`))
                expect(cookie).toMatch(/^cs_refresh=rt-1;/)
                expect(cookie).toContain('HttpOnly')
                expect(cookie).toContain('SameSite=Lax')
                expect(cookie).toContain('Max-Age=3600')
                // Local dev is plain http.
                expect(cookie).not.toContain('Secure')
            }
        })

        it('marks the cookie Secure in production', async () => {
            environment.production = true
            bus.execute.mockResolvedValue(session('rt-1'))
            const res = await request(app.getHttpServer())
                .post('/sign-in')
                .set(COOKIE_MODE)
                .send(credentials)
                .expect(201)

            for (const cookie of setCookies(res)) expect(cookie).toContain('Secure')
        })

        it('sets no cookie when sign-in fails', async () => {
            bus.execute.mockRejectedValue(new InvalidCredentialsError())
            const res = await request(app.getHttpServer())
                .post('/sign-in')
                .set(COOKIE_MODE)
                .send(credentials)
                .expect(400)
            expect(res.body.code).toBe('INVALID_CREDENTIALS')
            expect(setCookies(res)).toEqual([])
        })
    })

    describe('POST /refresh-token', () => {
        it('rotates the cookie it was sent and keeps the token out of the body', async () => {
            bus.execute.mockResolvedValue(session('rt-2'))
            const res = await request(app.getHttpServer())
                .post('/refresh-token')
                .set(COOKIE_MODE)
                .set('Cookie', 'theme=dark; cs_refresh=rt-1')
                .send({})
                .expect(201)

            const feature = bus.execute.mock.calls[0][0]
            expect(feature).toBeInstanceOf(RefreshTokenFeature)
            expect(feature.payload).toEqual({ refreshToken: 'rt-1' })
            expect(res.body).not.toHaveProperty('refreshToken')
            expect(res.body.accessToken).toBe('access-1')
            const cookies = setCookies(res)
            expect(cookies).toHaveLength(2)
            for (const cookie of cookies) expect(cookie).toMatch(/^cs_refresh=rt-2;/)
        })

        // Without the header (which forces a CORS preflight) a cookie alone
        // can't mint a session.
        it('ignores the cookie without the transport header', async () => {
            const res = await request(app.getHttpServer())
                .post('/refresh-token')
                .set('Cookie', 'cs_refresh=rt-1')
                .send({})
                .expect(401)

            expect(res.body.code).toBe('REFRESH_TOKEN_NOT_FOUND')
            expect(bus.execute).not.toHaveBeenCalled()
        })

        it('answers 401 in cookie mode when there is no cookie', async () => {
            const res = await request(app.getHttpServer())
                .post('/refresh-token')
                .set(COOKIE_MODE)
                .send({})
                .expect(401)

            expect(res.body.code).toBe('REFRESH_TOKEN_NOT_FOUND')
            expect(bus.execute).not.toHaveBeenCalled()
        })

        it('works in body mode exactly as before', async () => {
            bus.execute.mockResolvedValue(session('rt-2'))
            const res = await request(app.getHttpServer())
                .post('/refresh-token')
                .send({ refreshToken: 'rt-1' })
                .expect(201)

            expect(bus.execute.mock.calls[0][0].payload).toEqual({
                refreshToken: 'rt-1',
            })
            expect(res.body).toEqual(session('rt-2'))
            expect(setCookies(res)).toEqual([])
        })

        it('prefers a token in the body over the cookie', async () => {
            bus.execute.mockResolvedValue(session('rt-2'))
            await request(app.getHttpServer())
                .post('/refresh-token')
                .set(COOKIE_MODE)
                .set('Cookie', 'cs_refresh=from-cookie')
                .send({ refreshToken: 'from-body' })
                .expect(201)

            expect(bus.execute.mock.calls[0][0].payload).toEqual({
                refreshToken: 'from-body',
            })
        })
    })

    describe('POST /sign-out', () => {
        const signedOut = { status: 'signed-out' }

        it('revokes the cookie token and clears both cookies in cookie mode', async () => {
            bus.execute.mockResolvedValue(signedOut)
            const res = await request(app.getHttpServer())
                .post('/sign-out')
                .set(COOKIE_MODE)
                .set('Cookie', 'cs_refresh=rt-1')
                .send({})
                .expect(201)

            const feature = bus.execute.mock.calls[0][0]
            expect(feature).toBeInstanceOf(SignOutFeature)
            expect(feature.payload).toEqual({ refreshToken: 'rt-1' })
            expect(res.body).toEqual(signedOut)
            const cookies = setCookies(res)
            expect(cookies).toHaveLength(2)
            for (const path of ['/refresh-token', '/sign-out']) {
                const cookie = cookies.find((c) => c.includes(`Path=${path};`))
                expect(cookie).toMatch(/^cs_refresh=;/)
                expect(cookie).toContain('Expires=Thu, 01 Jan 1970')
            }
        })

        it('still clears the cookie when it has already expired', async () => {
            bus.execute.mockResolvedValue(signedOut)
            const res = await request(app.getHttpServer())
                .post('/sign-out')
                .set(COOKIE_MODE)
                .send({})
                .expect(201)

            expect(bus.execute.mock.calls[0][0].payload).toEqual({
                refreshToken: undefined,
            })
            expect(setCookies(res)).toHaveLength(2)
        })

        it('leaves cookies alone in body mode', async () => {
            bus.execute.mockResolvedValue(signedOut)
            const res = await request(app.getHttpServer())
                .post('/sign-out')
                .set('Cookie', 'cs_refresh=rt-cookie')
                .send({ refreshToken: 'rt-1' })
                .expect(201)

            expect(bus.execute.mock.calls[0][0].payload).toEqual({
                refreshToken: 'rt-1',
            })
            expect(setCookies(res)).toEqual([])
        })
    })

    describe('POST /me/sign-out-everywhere', () => {
        it('clears the cookie in cookie mode', async () => {
            bus.execute.mockResolvedValue({ status: 'signed-out' })
            const res = await request(app.getHttpServer())
                .post('/me/sign-out-everywhere')
                .set(COOKIE_MODE)
                .expect(200)

            expect(bus.execute.mock.calls[0][0].userId).toBe('u1')
            const cookies = setCookies(res)
            expect(cookies).toHaveLength(2)
            for (const cookie of cookies) expect(cookie).toMatch(/^cs_refresh=;/)
        })

        it('sets nothing in body mode', async () => {
            bus.execute.mockResolvedValue({ status: 'signed-out' })
            const res = await request(app.getHttpServer())
                .post('/me/sign-out-everywhere')
                .expect(200)
            expect(setCookies(res)).toEqual([])
        })
    })

    // app. and pwa. are same-site with credentialed CORS: a script there that
    // sends the header must get nowhere near the admin's cookie.
    describe.each(NEIGHBOURS)('another site in CORS_ORIGINS (%s)', (origin) => {
        const asNeighbour = { 'X-Token-Transport': 'cookie', Origin: origin }

        it('gets no cookie from sign-in, the token stays in its body', async () => {
            bus.execute.mockResolvedValue(session('rt-1'))
            const res = await request(app.getHttpServer())
                .post('/sign-in')
                .set(asNeighbour)
                .send({ email: 'owner@academy.demo', code: '123456' })
                .expect(201)

            expect(res.body).toEqual(session('rt-1'))
            expect(setCookies(res)).toEqual([])
        })

        it('cannot refresh with the admin cookie', async () => {
            const res = await request(app.getHttpServer())
                .post('/refresh-token')
                .set(asNeighbour)
                .set('Cookie', 'cs_refresh=admin-rt')
                .send({})
                .expect(401)

            expect(res.body.code).toBe('REFRESH_TOKEN_NOT_FOUND')
            expect(bus.execute).not.toHaveBeenCalled()
            expect(setCookies(res)).toEqual([])
        })

        it('cannot revoke or clear the admin cookie through sign-out', async () => {
            bus.execute.mockResolvedValue({ status: 'signed-out' })
            const res = await request(app.getHttpServer())
                .post('/sign-out')
                .set(asNeighbour)
                .set('Cookie', 'cs_refresh=admin-rt')
                .send({})
                .expect(201)

            expect(bus.execute.mock.calls[0][0].payload).toEqual({
                refreshToken: undefined,
            })
            expect(setCookies(res)).toEqual([])
        })

        it('does not clear the admin cookie through sign-out-everywhere', async () => {
            bus.execute.mockResolvedValue({ status: 'signed-out' })
            const res = await request(app.getHttpServer())
                .post('/me/sign-out-everywhere')
                .set(asNeighbour)
                .expect(200)
            expect(setCookies(res)).toEqual([])
        })
    })

    it('ignores the header without any Origin (non-browser callers)', async () => {
        bus.execute.mockResolvedValue(session('rt-1'))
        const res = await request(app.getHttpServer())
            .post('/sign-in')
            .set('X-Token-Transport', 'cookie')
            .send({ email: 'owner@academy.demo', code: '123456' })
            .expect(201)
        expect(res.body).toEqual(session('rt-1'))
        expect(setCookies(res)).toEqual([])
    })
})
