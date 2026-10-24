jest.mock('../../domains/tokens/services/tokens.service', () => ({
    TokensService: class {},
}))
jest.mock('../../domains/users/services/users.service', () => ({
    UsersService: class {},
}))

jest.mock('../../infrastructure/prisma', () => ({ PrismaService: class {} }))
jest.mock('../../environments/environment', () => ({
    environment: {
        adminEmail: 'admin@super.com',
        storeReview: { email: undefined, code: undefined },
    },
}))

import { environment } from '../../environments/environment'
import { UserBlockedRefreshError } from './refresh-token.feature'
import { RefreshTokenFeature } from './refresh-token.feature'
import { RefreshTokenHandler } from './refresh-token.handler'

const build = (
    user: { id: string; status: string; email?: string; isSuperAdmin?: boolean },
    access: { owned?: unknown; roles?: string[] } = {},
) => {
    const prisma = {
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
    const tokens = {
        verifyStoredToken: jest
            .fn()
            .mockResolvedValue({ jti: 'old-jti', sub: user.id }),
        revokeStoredToken: jest.fn().mockResolvedValue(true),
        generateToken: jest.fn().mockResolvedValue('new-access'),
        generateStoredToken: jest.fn().mockResolvedValue('new-refresh'),
        accessTokenTTL: 900,
    }
    const users = { getUserById: jest.fn().mockResolvedValue(user) }
    const handler = new RefreshTokenHandler(
        tokens as never,
        users as never,
        prisma as never,
    )
    return { handler, tokens, users }
}

const run = (handler: RefreshTokenHandler) =>
    handler.execute(
        new RefreshTokenFeature({ refreshToken: 'old-refresh' }) as never,
    )

describe('RefreshTokenHandler', () => {
    it('rotates the token: revokes the old jti and issues a fresh pair', async () => {
        const { handler, tokens } = build({ id: 'u1', status: 'ACTIVE' })
        const result = await run(handler)

        expect(tokens.revokeStoredToken).toHaveBeenCalledWith({ jti: 'old-jti' })
        expect(tokens.generateStoredToken).toHaveBeenCalledWith({ userId: 'u1' })
        expect(result).toMatchObject({
            userId: 'u1',
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
        })
        expect(result.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
    })

    it('revokes the presented token before rejecting a blocked user', async () => {
        const { handler, tokens } = build({ id: 'u1', status: 'BLOCKED' })
        await expect(run(handler)).rejects.toBeInstanceOf(UserBlockedRefreshError)
        // The old token is revoked regardless, so it can't be reused.
        expect(tokens.revokeStoredToken).toHaveBeenCalledWith({ jti: 'old-jti' })
        expect(tokens.generateStoredToken).not.toHaveBeenCalled()
    })

    it('refuses a DELETED user and does not issue a new token', async () => {
        const { handler, tokens } = build({ id: 'u1', status: 'DELETED' })
        await expect(run(handler)).rejects.toBeInstanceOf(UserBlockedRefreshError)
        expect(tokens.revokeStoredToken).toHaveBeenCalledWith({ jti: 'old-jti' })
        expect(tokens.generateStoredToken).not.toHaveBeenCalled()
    })

    it('propagates verification failure (revoked/expired token)', async () => {
        const { handler, tokens } = build({ id: 'u1', status: 'ACTIVE' })
        ;(tokens.verifyStoredToken as jest.Mock).mockRejectedValue(
            new Error('revoked'),
        )
        await expect(run(handler)).rejects.toThrow()
        expect(tokens.generateStoredToken).not.toHaveBeenCalled()
    })
})

describe('RefreshTokenHandler — store review account', () => {
    const reviewUser = { id: 'u1', status: 'ACTIVE', email: 'Review@B.com' }

    beforeEach(() => {
        environment.storeReview = { email: 'review@b.com', code: '730419' }
    })
    afterEach(() => {
        environment.storeReview = { email: undefined, code: undefined }
    })

    it('still refreshes a plain student review session', async () => {
        const { handler } = build(reviewUser)
        await expect(run(handler)).resolves.toMatchObject({ userId: 'u1' })
    })

    it.each([
        ['a coach membership', { roles: ['user', 'coach'] }],
        ['workspace ownership', { owned: { id: 'w1' } }],
    ])('revokes and refuses once it gains %s', async (_label, access) => {
        const { handler, tokens } = build(reviewUser, access)
        await expect(run(handler)).rejects.toBeInstanceOf(UserBlockedRefreshError)
        expect(tokens.revokeStoredToken).toHaveBeenCalledWith({ jti: 'old-jti' })
        expect(tokens.generateStoredToken).not.toHaveBeenCalled()
    })

    it('refuses once it becomes a super admin', async () => {
        const { handler, tokens } = build({ ...reviewUser, isSuperAdmin: true })
        await expect(run(handler)).rejects.toBeInstanceOf(UserBlockedRefreshError)
        expect(tokens.generateStoredToken).not.toHaveBeenCalled()
    })
})
