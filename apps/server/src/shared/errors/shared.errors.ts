import { DefaultError } from './default.error'

export class UnexpectedError extends DefaultError {
    constructor(payload: { message: string }) {
        super({
            message: payload.message,
            code: 'UNEXPECTED_ERROR',
            metadata: {},
            statusCode: 500,
        })
    }
}

export class NotImplementedError extends DefaultError {
    constructor(feature: string) {
        super({
            message: `${feature} is not implemented yet`,
            code: 'NOT_IMPLEMENTED',
            statusCode: 400,
        })
    }
}

export class UnauthorizedError extends DefaultError {
    constructor(payload?: { message?: string }) {
        super({
            message: payload?.message || 'Unauthorized',
            code: 'UNAUTHORIZED',
            statusCode: 401,
        })
    }
}

export class ForbiddenError extends DefaultError {
    constructor(payload?: { message?: string }) {
        super({
            message: payload?.message || 'Forbidden',
            code: 'FORBIDDEN',
            statusCode: 403,
        })
    }
}

export class BadRequestError extends DefaultError {
    constructor(payload: { message: string }) {
        super({
            message: payload.message,
            code: 'BAD_REQUEST',
            statusCode: 400,
        })
    }
}

export class UserBlockedError extends DefaultError {
    constructor() {
        super({
            message: 'User is blocked',
            code: 'USER_BLOCKED',
            statusCode: 403,
        })
    }
}

export class NotFoundError extends DefaultError {
    constructor(payload: { message: string }) {
        super({
            message: payload.message,
            code: 'NOT_FOUND',
            statusCode: 404,
        })
    }
}

export class EntityInUseError extends DefaultError {
    constructor(payload: { entityName: string }) {
        super({
            message: `Entity ${payload.entityName} is in use by another entity`,
            code: 'ENTITY_IN_USE',
            statusCode: 400,
        })
    }
}
