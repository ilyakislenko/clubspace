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

export class UserBlockedRefreshError extends DefaultError {
    constructor() {
        super({
            message: 'Обновление сессии заблокировано',
            code: 'USER_BLOCKED_REFRESH',
            statusCode: 401,
        })
    }
}
