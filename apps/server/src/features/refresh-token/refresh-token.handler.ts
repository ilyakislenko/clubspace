import { Feature, IFeatureHandler } from '@shelfjs/features'

import { TokensService } from '../../domains/tokens/services/tokens.service'
import { UsersService } from '../../domains/users/services/users.service'
import {
    RefreshTokenFeature,
    RefreshTokenFeatureResponse,
    UserBlockedRefreshError,
} from './refresh-token.feature'
@Feature(RefreshTokenFeature)
export class RefreshTokenHandler
    implements
        IFeatureHandler<RefreshTokenFeature, RefreshTokenFeatureResponse>
{
    constructor(
        private readonly tokens: TokensService,
        private readonly usersService: UsersService,
    ) {}

    async execute({
        payload,
    }: RefreshTokenFeature): Promise<RefreshTokenFeatureResponse> {
        const { refreshToken } = payload

        const refreshTokenPayload = await this.tokens.verifyStoredToken({
            token: refreshToken,
        })

        await this.tokens.revokeStoredToken({
            jti: refreshTokenPayload.jti,
        })

        const user = await this.usersService.getUserById({
            id: refreshTokenPayload.sub,
        })

        if (user.status === 'BLOCKED') {
            throw new UserBlockedRefreshError()
        }

        const accessToken = await this.tokens.generateToken({
            userId: user.id,
        })

        const newRefreshToken = await this.tokens.generateStoredToken({
            userId: user.id,
        })

        return {
            userId: user.id,
            accessToken,
            refreshToken: newRefreshToken,
            expiresAt:
                Math.floor(Date.now() / 1000) + this.tokens.accessTokenTTL,
        }
    }
}
