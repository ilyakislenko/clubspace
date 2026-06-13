import { Feature, IFeatureHandler } from '@shelfjs/features'

import { TokensService } from '../../domains/tokens/services/tokens.service'
import {
    SignOutFeature,
    SignOutFeatureResponse,
} from './sign-out.feature'

@Feature(SignOutFeature)
export class SignOutHandler
    implements IFeatureHandler<SignOutFeature, SignOutFeatureResponse>
{
    constructor(private readonly tokens: TokensService) {}

    async execute({ payload }: SignOutFeature): Promise<SignOutFeatureResponse> {
        // Sign-out is idempotent: the goal is that the presented refresh token
        // can no longer mint sessions. If it's still valid, revoke it; if it's
        // already revoked / expired / malformed it's effectively dead anyway,
        // so we swallow and report success either way.
        try {
            const { jti } = await this.tokens.verifyStoredToken({
                token: payload.refreshToken,
            })
            await this.tokens.revokeStoredToken({ jti })
        } catch {
            // Token already unusable — nothing to revoke.
        }

        return { status: 'signed-out' }
    }
}
