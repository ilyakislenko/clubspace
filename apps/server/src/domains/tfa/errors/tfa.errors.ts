import { DefaultError } from '../../../shared/errors/default.error'

// Sign-in: the e-mailed code was right and the account has an authenticator;
// the client asks for its code and sends both again.
export class TfaCodeRequiredError extends DefaultError {
    constructor() {
        super({
            code: 'TFA_CODE_REQUIRED',
            message: 'Введите код из приложения-аутентификатора',
        })
    }
}

export class TfaCodeInvalidError extends DefaultError {
    constructor() {
        super({
            code: 'TFA_CODE_INVALID',
            message: 'Неверный код из приложения-аутентификатора',
        })
    }
}

// Replacing a confirmed authenticator from a session would let whoever holds
// that session (without the old device) take the second factor over; a lost
// device is reset by the operator (deploy/README.md).
export class TfaAlreadyEnabledError extends DefaultError {
    constructor() {
        super({
            code: 'TFA_ALREADY_ENABLED',
            message: 'Двухфакторная защита уже включена',
            statusCode: 409,
        })
    }
}

export class TfaEnrollmentNotStartedError extends DefaultError {
    constructor() {
        super({
            code: 'TFA_ENROLLMENT_NOT_STARTED',
            message: 'Сначала получите новый ключ для приложения',
        })
    }
}
