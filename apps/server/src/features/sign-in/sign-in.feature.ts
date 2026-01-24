import { z } from 'zod'
import { DefaultError } from '../../shared/errors/default.error'

export const SignInFeatureInputSchema = z.object({
    email: z.string().email(),
    code: z.string().length(6),
})

export const SignInFeatureOutputSchema = z.object({
    userId: z.string(),
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresAt: z.number(),
})

export class SignInFeature {
    constructor(readonly payload: z.infer<typeof SignInFeatureInputSchema>) {}
}

export type SignInFeatureResponse = z.infer<typeof SignInFeatureOutputSchema>

export class InvalidCredentialsError extends DefaultError {
    constructor() {
        super({
            message: 'Invalid credentials',
            code: 'INVALID_CREDENTIALS',
            statusCode: 400,
        })
    }
}

export class UserNotActivatedError extends DefaultError {
    constructor() {
        super({
            message: 'User account is not activated',
            code: 'USER_NOT_ACTIVATED',
            statusCode: 400,
        })
    }
}
