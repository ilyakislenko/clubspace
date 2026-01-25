import { z } from 'zod'
import { DefaultError } from '../../shared/errors/default.error'

export const RefreshTokenFeatureInputSchema = z.object({
    refreshToken: z.string().nonempty(),
})

export const RefreshTokenFeatureOutputSchema = z.object({
    userId: z.string(),
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresAt: z.number(),
})

export class RefreshTokenFeature {
    constructor(
        readonly payload: z.infer<typeof RefreshTokenFeatureInputSchema>,
    ) {}
}

export type RefreshTokenFeatureResponse = z.infer<
    typeof RefreshTokenFeatureOutputSchema
>

export class RefreshTokenNotFoundError extends DefaultError {
    constructor({ id }: { id: string }) {
        super({
            message: `Refresh token not found: ${id}`,
            code: 'REFRESH_TOKEN_NOT_FOUND',
            statusCode: 404,
        })
    }
}

export class RefreshTokenRevokedError extends DefaultError {
    constructor() {
        super({
            message: 'Refresh token revoked',
            code: 'REFRESH_TOKEN_REVOKED',
            statusCode: 401,
        })
    }
}

export class UserBlockedRefreshError extends DefaultError {
    constructor() {
        super({
            message: 'User blocked refresh',
            code: 'USER_BLOCKED_REFRESH',
            statusCode: 401,
        })
    }
}

export class RefreshTokenMalformedError extends DefaultError {
    constructor() {
        super({
            message: 'Refresh token malformed',
            code: 'REFRESH_TOKEN_MALFORMED',
            statusCode: 401,
        })
    }
}
