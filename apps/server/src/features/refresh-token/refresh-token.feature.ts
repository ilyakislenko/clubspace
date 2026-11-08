import { z } from 'zod'
import { DefaultError } from '../../shared/errors/default.error'

export const RefreshTokenFeatureInputSchema = z.object({
    // Omitted by a cookie-transport client (X-Token-Transport: cookie): the
    // token then comes from the HttpOnly refresh cookie.
    refreshToken: z.string().nonempty().optional(),
})

export const RefreshTokenFeatureOutputSchema = z.object({
    userId: z.string(),
    accessToken: z.string(),
    // Absent in the cookie transport: the rotated token is set as the cookie.
    refreshToken: z.string().optional(),
    expiresAt: z.number(),
})

export class RefreshTokenFeature {
    // The token from the body or the cookie, resolved by the controller.
    constructor(readonly payload: { refreshToken: string }) {}
}

export type RefreshTokenFeatureResponse = z.infer<
    typeof RefreshTokenFeatureOutputSchema
> & { refreshToken: string }

export class UserBlockedRefreshError extends DefaultError {
    constructor() {
        super({
            message: 'Обновление сессии заблокировано',
            code: 'USER_BLOCKED_REFRESH',
            statusCode: 401,
        })
    }
}
