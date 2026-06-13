jest.mock('../../domains/tokens/services/tokens.service', () => ({
    TokensService: class {},
}))
jest.mock('../../domains/users/services/users.service', () => ({
    UsersService: class {},
}))

import { UserBlockedRefreshError } from './refresh-token.feature'
import { RefreshTokenFeature } from './refresh-token.feature'
import { RefreshTokenHandler } from './refresh-token.handler'

const build = (user: { id: string; status: string }) => {
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
    const handler = new RefreshTokenHandler(tokens as never, users as never)
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

    it('propagates verification failure (revoked/expired token)', async () => {
        const { handler, tokens } = build({ id: 'u1', status: 'ACTIVE' })
        ;(tokens.verifyStoredToken as jest.Mock).mockRejectedValue(
            new Error('revoked'),
        )
        await expect(run(handler)).rejects.toThrow()
        expect(tokens.generateStoredToken).not.toHaveBeenCalled()
    })
})
