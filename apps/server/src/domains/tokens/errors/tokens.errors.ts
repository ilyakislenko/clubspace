import { DefaultError } from '../../../shared/errors/default.error'

// Every token failure is a 401: the session is over and the client must sign
// in again (libs/api-client clears its tokens on a failed refresh).

export class TokenMalformedError extends DefaultError {
    constructor() {
        super({
            message: 'Некорректный токен',
            code: 'TOKEN_MALFORMED',
            statusCode: 401,
        })
    }
}

export class TokenNotFoundError extends DefaultError {
    constructor() {
        super({
            message: 'Сессия не найдена — войдите снова',
            code: 'REFRESH_TOKEN_NOT_FOUND',
            statusCode: 401,
        })
    }
}

export class TokenRevokedError extends DefaultError {
    constructor() {
        super({
            message: 'Сессия завершена — войдите снова',
            code: 'REFRESH_TOKEN_REVOKED',
            statusCode: 401,
        })
    }
}

export class TokenExpiredError extends DefaultError {
    constructor() {
        super({
            message: 'Срок действия токена истёк',
            code: 'REFRESH_TOKEN_EXPIRED',
            statusCode: 401,
        })
    }
}
