import { TokensService } from '../../domains/tokens/services/tokens.service'
import { SignOutFeature } from './sign-out.feature'
import { SignOutHandler } from './sign-out.handler'

const buildTokens = (overrides: Partial<TokensService> = {}) =>
    ({
        verifyStoredToken: jest.fn(),
        revokeStoredToken: jest.fn().mockResolvedValue(true),
        ...overrides,
    }) as unknown as TokensService

describe('SignOutHandler', () => {
    it('revokes the stored token when it is valid', async () => {
        const tokens = buildTokens({
            verifyStoredToken: jest
                .fn()
                .mockResolvedValue({ jti: 'jti-1', sub: 'user-1' }),
        })
        const handler = new SignOutHandler(tokens)

        const result = await handler.execute(
            new SignOutFeature({ refreshToken: 'valid-token' }),
        )

        expect(tokens.revokeStoredToken).toHaveBeenCalledWith({ jti: 'jti-1' })
        expect(result).toEqual({ status: 'signed-out' })
    })

    it('still reports signed-out when the token is already invalid', async () => {
        const tokens = buildTokens({
            verifyStoredToken: jest
                .fn()
                .mockRejectedValue(new Error('revoked')),
        })
        const handler = new SignOutHandler(tokens)

        const result = await handler.execute(
            new SignOutFeature({ refreshToken: 'dead-token' }),
        )

        expect(tokens.revokeStoredToken).not.toHaveBeenCalled()
        expect(result).toEqual({ status: 'signed-out' })
    })
})
