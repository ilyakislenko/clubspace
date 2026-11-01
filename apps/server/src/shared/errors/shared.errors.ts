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

// The signed-in user has not accepted the current edition of the personal-data
// consent. Clients show the blocking consent screen on this code.
export class ConsentRequiredError extends DefaultError {
    constructor() {
        super({
            message: 'Примите согласие на обработку персональных данных',
            code: 'CONSENT_REQUIRED',
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

// The club is switched off: by the platform (Workspace.isActive = false) or
// for non-payment (billing SUSPENDED). Members get this on every club route;
// the metadata is what a "club suspended" screen needs to render.
export class WorkspaceSuspendedError extends DefaultError {
    constructor(payload: {
        workspaceId: string
        workspaceName: string
        reason: 'INACTIVE' | 'SUSPENDED'
    }) {
        super({
            message:
                payload.reason === 'SUSPENDED'
                    ? `Клуб «${payload.workspaceName}» приостановлен: закончился оплаченный период. Владелец клуба может продлить доступ в админке, раздел «Тариф».`
                    : `Клуб «${payload.workspaceName}» временно отключён. Обратитесь к администратору клуба.`,
            code: 'WORKSPACE_SUSPENDED',
            statusCode: 403,
            metadata: {
                workspaceId: payload.workspaceId,
                workspaceName: payload.workspaceName,
                reason: payload.reason,
            },
        })
    }
}

// A paid platform module (VIDEO / ONLINE_PAYMENTS) is not part of the club's
// subscription: neither paid nor granted, and the trial is over. The message
// is what the club sees; the module code lets a client show its own state.
export class ModuleNotEntitledError extends DefaultError {
    constructor(payload: { module: string; message: string }) {
        super({
            message: payload.message,
            code: 'MODULE_NOT_ENTITLED',
            statusCode: 403,
            metadata: { module: payload.module },
        })
    }
}

// A trial cap is reached (domains/billing/trial-limits.ts): the club's staff
// get the reason and «Оплатите тариф, чтобы снять ограничение»; `limit` lets a
// client link to the «Тариф» page. Students get a neutral message instead —
// with no limit in the metadata, so nothing billing-related leaks to them.
export class TrialLimitReachedError extends DefaultError {
    constructor(payload: {
        limit: 'VIDEO_STORAGE' | 'VIDEO_VIEWING' | null
        message: string
    }) {
        super({
            message: payload.message,
            code: 'TRIAL_LIMIT_REACHED',
            statusCode: 403,
            metadata: payload.limit ? { limit: payload.limit } : {},
        })
    }
}
