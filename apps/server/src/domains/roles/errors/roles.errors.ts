import { DefaultError } from '../../../shared/errors/default.error'

export class RoleNotFoundError extends DefaultError {
    constructor(payload: { id: string }) {
        super({
            message: `Роль ${payload.id} не найдена`,
            code: 'ROLE_NOT_FOUND',
            statusCode: 404,
            metadata: { id: payload.id },
        })
    }
}

export class UserNotInRoleHierarchyError extends DefaultError {
    constructor(payload: { message: string }) {
        super({
            message: payload.message,
            code: 'USER_NOT_IN_ROLE_HIERARCHY',
            statusCode: 403,
        })
    }
}
