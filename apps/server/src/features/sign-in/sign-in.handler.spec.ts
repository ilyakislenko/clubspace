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
import { InvalidCredentialsError, SignInFeature } from './sign-in.feature'
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
        user: { update: jest.fn().mockResolvedValue({}) },
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
        await expect(run(handler, 'whatever')).rejects.toBeInstanceOf(
            UserBlockedError,
        )
        // No write — we bailed before touching attempt counters.
        expect(prisma.user.update).not.toHaveBeenCalled()
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

    it('increments the failure counter on a wrong code', async () => {
        const { handler, prisma } = build(baseUser({ signInFailedAttempts: 1 }))
        await expect(run(handler, '000000')).rejects.toBeInstanceOf(
            InvalidCredentialsError,
        )
        expect(prisma.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ signInFailedAttempts: 2 }),
            }),
        )
    })

    it('locks the account on the 5th wrong code', async () => {
        const { handler, prisma } = build(baseUser({ signInFailedAttempts: 4 }))
        await expect(run(handler, '000000')).rejects.toBeInstanceOf(
            InvalidCredentialsError,
        )
        const data = prisma.user.update.mock.calls[0][0].data
        expect(data.signInFailedAttempts).toBe(0)
        expect(data.signInLockedUntil).toBeInstanceOf(Date)
        expect(data.signInLockedUntil.getTime()).toBeGreaterThan(Date.now())
    })

    it('burns the code and issues tokens on the correct code', async () => {
        const { handler, prisma, tokens } = build(baseUser())
        const result = await run(handler)
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
    const REVIEW_CODE = '482916'
    const reviewUser = (o: UserOverrides = {}) =>
        baseUser({ completeCode: null, completeCodeIssuedAt: null, ...o })
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

    it('counts a wrong code as a failed attempt', async () => {
        const { handler, prisma, audit } = build(
            reviewUser({ signInFailedAttempts: 1 }),
        )
        await expect(runReview(handler, '111112')).rejects.toBeInstanceOf(
            InvalidCredentialsError,
        )
        expect(prisma.user.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ signInFailedAttempts: 2 }),
            }),
        )
        expect(audit.record).not.toHaveBeenCalled()
    })

    it('locks the account on the 5th wrong code', async () => {
        const { handler, prisma } = build(
            reviewUser({ signInFailedAttempts: 4 }),
        )
        await expect(runReview(handler, '111112')).rejects.toBeInstanceOf(
            InvalidCredentialsError,
        )
        const data = prisma.user.update.mock.calls[0][0].data
        expect(data.signInLockedUntil).toBeInstanceOf(Date)
    })

    it('refuses a locked account even with the right code', async () => {
        const { handler, tokens } = build(
            reviewUser({ signInLockedUntil: new Date(Date.now() + 60_000) }),
        )
        await expect(runReview(handler)).rejects.toBeInstanceOf(
            UserBlockedError,
        )
        expect(tokens.generateToken).not.toHaveBeenCalled()
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

    it('issues a session and audits on the right code, without bcrypt', async () => {
        const { handler, tokens, audit, prisma } = build(reviewUser(), {
            roles: ['user'],
        })
        const result = await runReview(handler)
        expect(bcrypt.compare).not.toHaveBeenCalled()
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
                data: { signInFailedAttempts: 0, signInLockedUntil: null },
            }),
        )
    })
})
