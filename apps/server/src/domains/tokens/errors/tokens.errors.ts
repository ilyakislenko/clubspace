import { DefaultError } from '../../../shared/errors/default.error'

export class TokenMalformedError extends DefaultError {
    constructor(metadata?: Record<string, any>) {
        super({
            message: 'Token is malformed',
            code: 'TOKEN_MALFORMED',
            statusCode: 422,
            metadata,
        })
    }
}

export class UserBlockedTokenError extends DefaultError {
    constructor() {
        super({
            message: 'Users token is blocked',
            code: 'USER_BLOCKED_TOKEN',
            statusCode: 403,
        })
    }
}

export class TokenNotFoundError extends DefaultError {
    constructor(payload: { id: string }) {
        super({
            message: `Refresh token with id ${payload.id} not found in database`,
            code: 'REFRESH_TOKEN_NOT_FOUND',
            statusCode: 422,
            metadata: { id: payload.id },
        })
    }
}

export class TokenRevokedError extends DefaultError {
    constructor() {
        super({
            message: 'User has already used this refresh token',
            code: 'REFRESH_TOKEN_REVOKED',
            statusCode: 422,
        })
    }
}

export class TokenExpiredError extends DefaultError {
    constructor() {
        super({
            message: 'Token has expired',
            code: 'REFRESH_TOKEN_EXPIRED',
            statusCode: 422,
        })
    }
}
