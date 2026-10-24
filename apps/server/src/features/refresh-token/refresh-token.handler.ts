import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { TokensService } from '../../domains/tokens/services/tokens.service'
import { UsersService } from '../../domains/users/services/users.service'
import { hasPrivilegedAccess } from '../../shared/utils/store-review-access.util'
import { isStoreReviewEmail } from '../../shared/utils/store-review.util'
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
        private readonly prisma: PrismaService,
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

        // Refuse anything that isn't an active account — BLOCKED and DELETED
        // users (and any future non-active status) must not be able to mint a
        // fresh access token off a still-valid refresh token.
        if (user.status !== 'ACTIVE') {
            throw new UserBlockedRefreshError()
        }

        // The store-review account is only ever a plain student. If that email
        // has since been given staff/owner/admin rights, its old review
        // sessions must not carry them forward (the presented token is already
        // revoked above).
        if (
            isStoreReviewEmail(user.email) &&
            (await hasPrivilegedAccess(this.prisma, user))
        ) {
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
