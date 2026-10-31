import type { TokensService } from '../../domains/tokens/services/tokens.service'
import { SignOutFeature } from './sign-out.feature'
import { SignOutHandler } from './sign-out.handler'

const buildTokens = (overrides: Partial<Record<keyof TokensService, unknown>> = {}) =>
    ({
        verifyStoredToken: jest.fn(),
        revokeStoredTokenFamily: jest.fn().mockResolvedValue(undefined),
        ...overrides,
    }) as unknown as TokensService

describe('SignOutHandler', () => {
    it('revokes the whole token family of the presented refresh token', async () => {
        const tokens = buildTokens({
            verifyStoredToken: jest.fn().mockResolvedValue({
                jti: 'jti-1',
                sub: 'user-1',
                familyId: 'fam-1',
            }),
        })
        const handler = new SignOutHandler(tokens)

        const result = await handler.execute(
            new SignOutFeature({ refreshToken: 'rt' }),
        )

        expect(tokens.revokeStoredTokenFamily).toHaveBeenCalledWith({
            familyId: 'fam-1',
        })
        expect(result).toEqual({ status: 'signed-out' })
    })

    it('still reports success when the token is already unusable', async () => {
        const tokens = buildTokens({
            verifyStoredToken: jest
                .fn()
                .mockRejectedValue(new Error('revoked')),
        })
        const handler = new SignOutHandler(tokens)

        const result = await handler.execute(
            new SignOutFeature({ refreshToken: 'rt' }),
        )

        expect(tokens.revokeStoredTokenFamily).not.toHaveBeenCalled()
        expect(result).toEqual({ status: 'signed-out' })
    })
})
