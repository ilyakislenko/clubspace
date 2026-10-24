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
            message: `${feature} пока не реализовано`,
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

export class ConflictError extends DefaultError {
    constructor(payload: { message: string }) {
        super({
            message: payload.message,
            code: 'CONFLICT',
            statusCode: 409,
        })
    }
}

export class UserBlockedError extends DefaultError {
    constructor() {
        super({
            message: 'Аккаунт заблокирован',
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
            message: `Объект ${payload.entityName} используется другим объектом`,
            code: 'ENTITY_IN_USE',
            statusCode: 400,
        })
    }
}

export class MailUnavailableError extends DefaultError {
    constructor() {
        super({
            message:
                'Не удалось отправить письмо с кодом: почта временно не работает. Попробуйте через несколько минут или сообщите администратору клуба.',
            code: 'MAIL_UNAVAILABLE',
            statusCode: 503,
        })
    }
}
