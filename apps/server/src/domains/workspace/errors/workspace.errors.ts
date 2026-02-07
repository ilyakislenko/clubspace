import { DefaultError } from '../../../shared/errors/default.error'

export class WorkspaceNotFoundError extends DefaultError {
    constructor(payload: { workspaceId?: string; userId: string }) {
        super({
            message: `Workspace not found for workspace ${payload.workspaceId} and user ${payload.userId}`,
            code: 'WORKSPACE_NOT_FOUND',
            statusCode: 404,
        })
    }
}

export class UserNotFoundError extends DefaultError {
    constructor(payload: { id: string }) {
        super({
            message: `User with id ${payload.id} not found`,
            code: 'USER_NOT_FOUND',
            statusCode: 404,
            metadata: { id: payload.id },
        })
    }
}

export class CannotChangeOwnerRoleError extends DefaultError {
    constructor() {
        super({
            message: 'Cannot change owner role',
            code: 'CANNOT_CHANGE_OWNER_ROLE',
            statusCode: 400,
        })
    }
}

export class InvalidRoleTypeError extends DefaultError {
    constructor() {
        super({
            message: 'Cannot change user role to this type',
            code: 'INVALID_ROLE_TYPE',
            statusCode: 400,
        })
    }
}

export class InvalidStatusTypeError extends DefaultError {
    constructor() {
        super({
            message: 'Cannot change user status to this type',
            code: 'INVALID_STATUS_TYPE',
            statusCode: 400,
        })
    }
}

export class PendingStatusError extends DefaultError {
    constructor() {
        super({
            message: 'Cannot change user status. Need to complete sign in',
            code: 'PENDING_STATUS',
            statusCode: 400,
        })
    }
}
