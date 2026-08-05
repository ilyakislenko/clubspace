import { DefaultError } from '../../../shared/errors/default.error'

export class WorkspaceNotFoundError extends DefaultError {
    constructor(payload: { workspaceId?: string; userId: string }) {
        super({
            message: `Клуб ${payload.workspaceId} не найден для пользователя ${payload.userId}`,
            code: 'WORKSPACE_NOT_FOUND',
            statusCode: 404,
        })
    }
}

export class UserNotFoundError extends DefaultError {
    constructor(payload: { id: string }) {
        super({
            message: `Пользователь ${payload.id} не найден`,
            code: 'USER_NOT_FOUND',
            statusCode: 404,
            metadata: { id: payload.id },
        })
    }
}

export class CannotChangeOwnerRoleError extends DefaultError {
    constructor() {
        super({
            message: 'Нельзя изменить роль владельца клуба',
            code: 'CANNOT_CHANGE_OWNER_ROLE',
            statusCode: 400,
        })
    }
}

export class InvalidRoleTypeError extends DefaultError {
    constructor() {
        super({
            message: 'Такую роль назначить нельзя',
            code: 'INVALID_ROLE_TYPE',
            statusCode: 400,
        })
    }
}

export class InvalidStatusTypeError extends DefaultError {
    constructor() {
        super({
            message: 'Такой статус назначить нельзя',
            code: 'INVALID_STATUS_TYPE',
            statusCode: 400,
        })
    }
}

export class PendingStatusError extends DefaultError {
    constructor() {
        super({
            message: 'Пользователь ещё не завершил вход',
            code: 'PENDING_STATUS',
            statusCode: 400,
        })
    }
}
