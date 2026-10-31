import * as bcrypt from 'bcrypt'
import { createHash } from 'crypto'
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
jest.mock(
    '../../domains/workspace/services/store-review-membership.service',
    () => ({ StoreReviewMembershipService: class {} }),
)

import { UserNoCompleteCodeError } from '../../domains/users/errors/users.errors'
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
    sessionVersion: 2,
    ...o,
})

const OWN_IP = '10.0.0.1'
const ATTACKER_IP = '6.6.6.6'
const ipHash = (ip: string) => createHash('sha256').update(ip).digest('hex')

const build = (
    user: unknown,
    access: { owned?: unknown; roles?: string[] } = {},
) => {
    const prisma = {
        user: {
            update: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        signInThrottle: {
            findUnique: jest.fn().mockResolvedValue(null),
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
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
    const storeReviewMembership = {
        ensureDemoMembership: jest.fn().mockResolvedValue(undefined),
    }
    const handler = new SignInHandler(
        tokens as never,
        users as never,
        prisma as never,
        audit as never,
        storeReviewMembership as never,
    )
    return { handler, prisma, tokens, audit, storeReviewMembership }
}

const run = (handler: SignInHandler, code = CODE, ip = OWN_IP) =>
    handler.execute(new SignInFeature({ email: 'a@b.com', code }, ip) as never)

describe('SignInHandler', () => {
    beforeEach(() => (bcrypt.compare as jest.Mock).mockClear())

    // Indistinguishable from an existing account with no pending code, and
    // nothing in the error names the address.
    it('answers an unknown email like an account without a code', async () => {
        const { handler } = build(null)
        const error = await run(handler).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(UserNoCompleteCodeError)
        const known = await run(build(baseUser({ completeCode: null })).handler)
            .catch((e: unknown) => e)
        expect(error).toMatchObject({
            code: known.code,
            message: known.message,
            metadata: {},
        })
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
        expect(prisma.signInThrottle.updateMany).not.toHaveBeenCalled()
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

    it('claims an attempt per address, then per account, before comparing the code', async () => {
        const { handler, prisma } = build(baseUser())
        await expect(run(handler, '000000')).rejects.toBeInstanceOf(
            InvalidCredentialsError,
        )
        expect(prisma.signInThrottle.createMany).toHaveBeenCalledWith({
            data: [{ userId: 'user-1', ipHash: ipHash(OWN_IP) }],
            skipDuplicates: true,
        })
        const addressClaim = prisma.signInThrottle.updateMany.mock.calls[0][0]
        expect(addressClaim.where).toMatchObject({
            userId: 'user-1',
            ipHash: ipHash(OWN_IP),
            failedAttempts: { lt: 5 },
        })
        expect(addressClaim.data).toEqual({ failedAttempts: { increment: 1 } })
        const accountClaim = prisma.user.updateMany.mock.calls[0][0]
        expect(accountClaim.where).toMatchObject({
            id: 'user-1',
            signInFailedAttempts: { lt: 10 },
        })
        expect(accountClaim.data).toEqual({
            signInFailedAttempts: { increment: 1 },
        })
        // Nothing is written from the stale row read.
        expect(prisma.user.update).not.toHaveBeenCalled()
    })

    it('never stores the client address in the clear', async () => {
        const { handler, prisma } = build(baseUser())
        await run(handler, '000000').catch(() => undefined)
        expect(JSON.stringify(prisma.signInThrottle.createMany.mock.calls))
            .not.toContain(OWN_IP)
    })

    it('starts both lockouts when the last tickets are spent on a wrong code', async () => {
        const { handler, prisma } = build(baseUser())
        await expect(run(handler, '000000')).rejects.toBeInstanceOf(
            InvalidCredentialsError,
        )
        const addressLock = prisma.signInThrottle.updateMany.mock.calls[1][0]
        expect(addressLock.where.failedAttempts).toEqual({ gte: 5 })
        expect(addressLock.data.failedAttempts).toBe(0)
        expect(addressLock.data.lockedUntil.getTime()).toBeGreaterThan(
            Date.now(),
        )
        const accountLock = prisma.user.updateMany.mock.calls[1][0]
        expect(accountLock.where.signInFailedAttempts).toEqual({ gte: 10 })
        expect(accountLock.data.signInFailedAttempts).toBe(0)
        expect(accountLock.data.signInLockedUntil.getTime()).toBeGreaterThan(
            Date.now(),
        )
    })

    it('refuses concurrent guesses once the address tickets are gone, without comparing', async () => {
        const { handler, prisma } = build(baseUser())
        // Only 5 of 20 simultaneous guesses from one address win a ticket.
        let tickets = 5
        prisma.signInThrottle.updateMany.mockImplementation(
            async (args: { data: { failedAttempts: unknown } }) => {
                if (
                    typeof args.data.failedAttempts === 'object' &&
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

    // The DoS the per-address counter exists for: a stranger guessing wrong
    // codes must not lock the owner out of their own device.
    it('locks the guessing address but lets the owner in from theirs', async () => {
        const { handler, prisma, tokens } = build(baseUser())
        prisma.signInThrottle.findUnique.mockImplementation(
            async (args: {
                where: { userId_ipHash: { ipHash: string } }
            }) =>
                args.where.userId_ipHash.ipHash === ipHash(ATTACKER_IP)
                    ? { lockedUntil: new Date(Date.now() + 60_000) }
                    : null,
        )

        await expect(
            run(handler, CODE, ATTACKER_IP),
        ).rejects.toBeInstanceOf(TooManySignInAttemptsError)
        expect(bcrypt.compare).not.toHaveBeenCalled()

        await expect(run(handler, CODE, OWN_IP)).resolves.toMatchObject({
            userId: 'user-1',
        })
        expect(tokens.generateToken).toHaveBeenCalledTimes(1)
    })

    it('refuses once the account-wide ceiling is spent, without comparing', async () => {
        const { handler, prisma } = build(baseUser())
        prisma.user.updateMany.mockResolvedValue({ count: 0 })
        await expect(run(handler)).rejects.toBeInstanceOf(
            TooManySignInAttemptsError,
        )
        expect(bcrypt.compare).not.toHaveBeenCalled()
        // lockIfExhausted ran after the failed claim.
        expect(prisma.user.updateMany).toHaveBeenCalledTimes(2)
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
        // Per-address counters go, except locks still running.
        expect(prisma.signInThrottle.deleteMany).toHaveBeenCalledWith({
            where: {
                userId: 'user-1',
                OR: [
                    { lockedUntil: null },
                    { lockedUntil: { lte: expect.any(Date) } },
                ],
            },
        })
        expect(tokens.generateToken).toHaveBeenCalledWith({
            userId: 'user-1',
            sessionVersion: 2,
        })
        expect(tokens.generateStoredToken).toHaveBeenCalledWith({
            userId: 'user-1',
        })
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
            new SignInFeature({ email: ' A@B.com ', code }, OWN_IP) as never,
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
            UserNoCompleteCodeError,
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
        const { handler, prisma, audit, storeReviewMembership } =
            build(reviewUser())
        await expect(runReview(handler, '111112')).rejects.toBeInstanceOf(
            InvalidCredentialsError,
        )
        expect(prisma.user.updateMany.mock.calls[0][0].data).toEqual({
            signInFailedAttempts: { increment: 1 },
        })
        expect(prisma.user.updateMany.mock.calls[1][0].data.signInLockedUntil)
            .toBeInstanceOf(Date)
        expect(audit.record).not.toHaveBeenCalled()
        expect(storeReviewMembership.ensureDemoMembership).not.toHaveBeenCalled()
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
        const { handler, tokens, storeReviewMembership } = build(
            reviewUser(),
            { owned: { id: 'w1' } },
        )
        await expect(runReview(handler)).rejects.toBeInstanceOf(
            InvalidCredentialsError,
        )
        expect(tokens.generateToken).not.toHaveBeenCalled()
        // A refused review sign-in never touches the demo club.
        expect(storeReviewMembership.ensureDemoMembership).not.toHaveBeenCalled()
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
        const { handler, tokens, audit, prisma, storeReviewMembership } =
            build(reviewUser(), { roles: ['user'] })
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
        // The reviewer lands in the demo club before the session is issued.
        expect(storeReviewMembership.ensureDemoMembership).toHaveBeenCalledWith(
            'user-1',
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
