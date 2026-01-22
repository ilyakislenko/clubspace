import { DefaultError } from '../../../shared/errors/default.error'

export class RoleNotFoundError extends DefaultError {
    constructor(payload: { id: string }) {
        super({
            message: `Role with id ${payload.id} not found`,
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
