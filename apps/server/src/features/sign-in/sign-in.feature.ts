import { z } from 'zod'
import { DefaultError } from '../../shared/errors/default.error'
import { emailSchema } from '../../shared/utils/email'

export const SignInFeatureInputSchema = z.object({
    email: emailSchema,
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
            message: 'Неверный код',
            code: 'INVALID_CREDENTIALS',
            statusCode: 400,
        })
    }
}

export class UserNotActivatedError extends DefaultError {
    constructor() {
        super({
            message: 'Аккаунт не активирован',
            code: 'USER_NOT_ACTIVATED',
            statusCode: 400,
        })
    }
}

// The 15-minute sign-in lockout after too many wrong codes. Not
// UserBlockedError: that is a 403 for banned accounts and clients treat 403
// as "forbidden", which a temporary lockout is not.
export class TooManySignInAttemptsError extends DefaultError {
    constructor(lockoutMinutes: number) {
        super({
            message: `Слишком много неверных попыток. Попробуйте снова через ${lockoutMinutes} минут.`,
            code: 'TOO_MANY_SIGN_IN_ATTEMPTS',
            statusCode: 429,
        })
    }
}
