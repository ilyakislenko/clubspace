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

export type PlanLimit = 'members' | 'coaches' | 'storage' | 'videos'

const PLAN_LIMIT_TEXT: Record<PlanLimit, string> = {
    members: 'участников',
    coaches: 'тренеров и администраторов',
    storage: 'места для видео',
    videos: 'видео',
}

// A write that would take the club past its platform plan. `limit` says which
// one, so the admin can point at the right usage bar and offer the upgrade.
export class PlanLimitReachedError extends DefaultError {
    constructor(payload: {
        limit: PlanLimit
        max: number
        used: number
        planName: string
    }) {
        super({
            message: `Достигнут лимит тарифа «${payload.planName}»: не хватает ${PLAN_LIMIT_TEXT[payload.limit]}. Перейдите на тариф выше в разделе «Тариф и лимиты».`,
            code: 'PLAN_LIMIT_REACHED',
            statusCode: 403,
            metadata: {
                limit: payload.limit,
                max: payload.max,
                used: payload.used,
                planName: payload.planName,
            },
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
                    ? `Клуб «${payload.workspaceName}» приостановлен: закончился оплаченный период. Владелец клуба может продлить доступ в админке, раздел «Тариф и лимиты».`
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
