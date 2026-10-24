import * as bcrypt from 'bcrypt'
import { hash } from 'bcrypt'

// Mock the modules that transitively import the ESM-only generated prisma
// client; the handler receives plain stubs below.
jest.mock('bcrypt', () => {
    const actual = jest.requireActual('bcrypt')
    return { ...actual, compare: jest.fn(actual.compare) }
})
jest.mock('../../environments/environment', () => ({
    environment: {
        adminEmail: 'admin@super.com',
        storeReview: { email: undefined, code: undefined },
    },
}))
jest.mock('../../infrastructure/prisma', () => ({ PrismaService: class {} }))
jest.mock('../../domains/tokens/services/tokens.service', () => ({
    TokensService: class {},
}))
jest.mock('../../domains/users/services/users.service', () => ({
    UsersService: class {},
}))

import {
    UserNoCompleteCodeError,
    UserNotFoundError,
} from '../../domains/users/errors/users.errors'
import { environment } from '../../environments/environment'
import { UserBlockedError } from '../../shared/errors/shared.errors'
import {
    InvalidCredentialsError,
    SignInFeature,
    TooManySignInAttemptsError,
} from './sign-in.feature'
import { SignInHandler } from './sign-in.handler'

const CODE = '123456'
let codeHash: string

beforeAll(async () => {
    codeHash = await hash(CODE, 10)
})

type UserOverrides = Record<string, unknown>

const baseUser = (o: UserOverrides = {}) => ({
    id: 'user-1',
    email: 'a@b.com',
    status: 'ACTIVE',
    completeCode: codeHash,
    completeCodeIssuedAt: new Date(),
    signInFailedAttempts: 0,
    signInLockedUntil: null,
    isSuperAdmin: false,
    ...o,
})

const build = (
    user: unknown,
    access: { owned?: unknown; roles?: string[] } = {},
) => {
    const prisma = {
        user: {
            update: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        workspace: {
            findFirst: jest.fn().mockResolvedValue(access.owned ?? null),
        },
        workspaceMember: {
            findMany: jest
                .fn()
                .mockResolvedValue(
                    (access.roles ?? ['user']).map((name) => ({
                        role: { name },
                    })),
                ),
        },
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const users = { getUserByEmail: jest.fn().mockResolvedValue(user) }
    const tokens = {
        generateToken: jest.fn().mockResolvedValue('access-token'),
        generateStoredToken: jest.fn().mockResolvedValue('refresh-token'),
        accessTokenTTL: 900,
    }
    const handler = new SignInHandler(
        tokens as never,
        users as never,
        prisma as never,
        audit as never,
    )
    return { handler, prisma, tokens, audit }
}

const run = (handler: SignInHandler, code = CODE) =>
    handler.execute(new SignInFeature({ email: 'a@b.com', code }) as never)

describe('SignInHandler', () => {
    beforeEach(() => (bcrypt.compare as jest.Mock).mockClear())

    it('rejects an unknown email', async () => {
        const { handler } = build(null)
        await expect(run(handler)).rejects.toBeInstanceOf(UserNotFoundError)
    })

    it('rejects a blocked user', async () => {
        const { handler } = build(baseUser({ status: 'BLOCKED' }))
        await expect(run(handler)).rejects.toBeInstanceOf(UserBlockedError)
    })

    it('rejects while the account is locked, before checking the code', async () => {
        const { handler, prisma } = build(
            baseUser({ signInLockedUntil: new Date(Date.now() + 60_000) }),
        )
        const error = await run(handler, 'whatever').catch((e) => e)
        expect(error).toBeInstanceOf(TooManySignInAttemptsError)
        expect(error.statusCode).toBe(429)
        expect(error.message).toContain('15 минут')
        // No write — we bailed before touching attempt counters.
        expect(prisma.user.update).not.toHaveBeenCalled()
        expect(prisma.user.updateMany).not.toHaveBeenCalled()
    })

    it('rejects when no code was issued', async () => {
        const { handler } = build(baseUser({ completeCode: null }))
        await expect(run(handler)).rejects.toBeInstanceOf(
            UserNoCompleteCodeError,
        )
    })

    it('rejects an expired code without a DB write', async () => {
        const { handler, prisma } = build(
            baseUser({
                completeCodeIssuedAt: new Date(Date.now() - 16 * 60 * 1000),
            }),
        )
        await expect(run(handler)).rejects.toBeInstanceOf(
            InvalidCredentialsError,
        )
        expect(prisma.user.update).not.toHaveBeenCalled()
    })

    it('claims an attempt atomically before comparing the code', async () => {
        const { handler, prisma } = build(baseUser())
        await expect(run(handler, '000000')).rejects.toBeInstanceOf(
            InvalidCredentialsError,
        )
        const claim = prisma.user.updateMany.mock.calls[0][0]
        expect(claim.where).toMatchObject({
            id: 'user-1',
            signInFailedAttempts: { lt: 5 },
        })
        expect(claim.data).toEqual({ signInFailedAttempts: { increment: 1 } })
        // Nothing is written from the stale row read.
        expect(prisma.user.update).not.toHaveBeenCalled()
    })

    it('starts the lockout when the last ticket is spent on a wrong code', async () => {
        const { handler, prisma } = build(baseUser())
        await expect(run(handler, '000000')).rejects.toBeInstanceOf(
            InvalidCredentialsError,
        )
        const lock = prisma.user.updateMany.mock.calls[1][0]
        expect(lock.where.signInFailedAttempts).toEqual({ gte: 5 })
        expect(lock.data.signInFailedAttempts).toBe(0)
        expect(lock.data.signInLockedUntil.getTime()).toBeGreaterThan(
            Date.now(),
        )
    })

    it('refuses concurrent guesses once the tickets are gone, without comparing', async () => {
        const { handler, prisma } = build(baseUser())
        // Only 5 of 20 simultaneous guesses win a ticket.
        let tickets = 5
        prisma.user.updateMany.mockImplementation(
            async (args: { data: { signInFailedAttempts: unknown } }) => {
                if (
                    typeof args.data.signInFailedAttempts === 'object' &&
                    tickets > 0
                ) {
                    tickets--
                    return { count: 1 }
                }
                return { count: tickets === 0 ? 0 : 1 }
            },
        )
        const results = await Promise.all(
            Array.from({ length: 20 }, () =>
                run(handler, '000000').catch((e) => e),
            ),
        )
        expect(
            results.filter((e) => e instanceof InvalidCredentialsError),
        ).toHaveLength(5)
        expect(
            results.filter((e) => e instanceof TooManySignInAttemptsError),
        ).toHaveLength(15)
        expect(bcrypt.compare).toHaveBeenCalledTimes(5)
    })

    it('burns the code and issues tokens on the correct code', async () => {
        const { handler, prisma, tokens } = build(baseUser())
        const result = await run(handler)
        expect(prisma.user.updateMany).toHaveBeenCalledTimes(1) // the claim
        expect(prisma.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    completeCode: null,
                    signInFailedAttempts: 0,
                    signInLockedUntil: null,
                }),
            }),
        )
        expect(tokens.generateStoredToken).toHaveBeenCalled()
        expect(result).toMatchObject({
            userId: 'user-1',
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
        })
    })
})

describe('SignInHandler — store review account', () => {
    const REVIEW_CODE = '730419'
    // send-auth-code stamps completeCodeIssuedAt for this account.
    const reviewUser = (o: UserOverrides = {}) =>
        baseUser({ completeCode: null, ...o })
    const runReview = (handler: SignInHandler, code = REVIEW_CODE) =>
        handler.execute(
            new SignInFeature({ email: ' A@B.com ', code }) as never,
        )

    beforeEach(() => {
        environment.storeReview = { email: 'a@b.com', code: REVIEW_CODE }
        ;(bcrypt.compare as jest.Mock).mockClear()
    })
    afterEach(() => {
        environment.storeReview = { email: undefined, code: undefined }
    })

    it('is a normal account when unconfigured', async () => {
        environment.storeReview = { email: undefined, code: undefined }
        const { handler } = build(reviewUser())
        await expect(run(handler, REVIEW_CODE)).rejects.toBeInstanceOf(
            UserNoCompleteCodeError,
        )
    })

    it('treats an unknown review user like any unknown email', async () => {
        const { handler } = build(null)
        await expect(runReview(handler)).rejects.toBeInstanceOf(
            UserNotFoundError,
        )
    })

    it('needs a requested code first, like a normal account', async () => {
        const { handler, tokens } = build(
            reviewUser({ completeCodeIssuedAt: null }),
        )
        await expect(runReview(handler)).rejects.toBeInstanceOf(
            UserNoCompleteCodeError,
        )
        expect(tokens.generateToken).not.toHaveBeenCalled()
    })

    it('rejects a stale request like an expired code', async () => {
        const { handler } = build(
            reviewUser({
                completeCodeIssuedAt: new Date(Date.now() - 16 * 60 * 1000),
            }),
        )
        await expect(runReview(handler)).rejects.toBeInstanceOf(
            InvalidCredentialsError,
        )
    })

    it('claims an attempt and starts the lockout on a wrong code', async () => {
        const { handler, prisma, audit } = build(reviewUser())
        await expect(runReview(handler, '111112')).rejects.toBeInstanceOf(
            InvalidCredentialsError,
        )
        expect(prisma.user.updateMany.mock.calls[0][0].data).toEqual({
            signInFailedAttempts: { increment: 1 },
        })
        expect(prisma.user.updateMany.mock.calls[1][0].data.signInLockedUntil)
            .toBeInstanceOf(Date)
        expect(audit.record).not.toHaveBeenCalled()
    })

    it('refuses with the lockout error when no ticket is left', async () => {
        const { handler, prisma, tokens } = build(reviewUser())
        prisma.user.updateMany.mockResolvedValue({ count: 0 })
        await expect(runReview(handler)).rejects.toBeInstanceOf(
            TooManySignInAttemptsError,
        )
        expect(tokens.generateToken).not.toHaveBeenCalled()
    })

    it('refuses a locked account even with the right code', async () => {
        const { handler, tokens } = build(
            reviewUser({ signInLockedUntil: new Date(Date.now() + 60_000) }),
        )
        await expect(runReview(handler)).rejects.toBeInstanceOf(
            TooManySignInAttemptsError,
        )
        expect(tokens.generateToken).not.toHaveBeenCalled()
    })

    it('refuses a blocked review user', async () => {
        const { handler } = build(reviewUser({ status: 'BLOCKED' }))
        await expect(runReview(handler)).rejects.toBeInstanceOf(
            UserBlockedError,
        )
    })

    it('refuses a super admin', async () => {
        const { handler, tokens } = build(reviewUser({ isSuperAdmin: true }))
        await expect(runReview(handler)).rejects.toBeInstanceOf(
            InvalidCredentialsError,
        )
        expect(tokens.generateToken).not.toHaveBeenCalled()
    })

    it('refuses a workspace owner', async () => {
        const { handler, tokens } = build(reviewUser(), {
            owned: { id: 'w1' },
        })
        await expect(runReview(handler)).rejects.toBeInstanceOf(
            InvalidCredentialsError,
        )
        expect(tokens.generateToken).not.toHaveBeenCalled()
    })

    it.each(['coach', 'head_coach', 'Admin'])(
        'refuses a user with a %s membership',
        async (role) => {
            const { handler, tokens } = build(reviewUser(), {
                roles: ['user', role],
            })
            await expect(runReview(handler)).rejects.toBeInstanceOf(
                InvalidCredentialsError,
            )
            expect(tokens.generateToken).not.toHaveBeenCalled()
        },
    )

    it('issues a session, audits and resets counters on the right code', async () => {
        const { handler, tokens, audit, prisma } = build(reviewUser(), {
            roles: ['user'],
        })
        const result = await runReview(handler)
        // Only the dummy compare for timing parity, never a real code hash.
        expect(bcrypt.compare).toHaveBeenCalledTimes(1)
        expect(tokens.generateStoredToken).toHaveBeenCalled()
        expect(result).toMatchObject({
            userId: 'user-1',
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
        })
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'auth.storeReviewSignIn',
                targetType: 'member',
                targetId: 'user-1',
                actorId: 'user-1',
                workspaceId: null,
            }),
        )
        expect(prisma.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    signInFailedAttempts: 0,
                    signInLockedUntil: null,
                }),
            }),
        )
    })
})
