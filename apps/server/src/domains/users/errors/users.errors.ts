import { DefaultError } from '../../../shared/errors/default.error'

export class UserNotFoundError extends DefaultError {
    constructor(payload: { id?: string; email?: string }) {
        let message = 'User not found'

        message = payload.email
            ? `User with email ${payload.email} not found`
            : `User with id ${payload.id} not found`

        super({
            code: 'USER_NOT_FOUND',
            message,
            metadata: payload,
        })
    }
}

export class UserAlreadyActivatedError extends DefaultError {
    constructor(payload: { id: string }) {
        super({
            code: 'USER_ALREADY_ACTIVATED',
            message: 'User already activated',
            metadata: payload,
        })
    }
}

export class UserInvalidCodeError extends DefaultError {
    constructor(payload: { id: string }) {
        super({
            code: 'USER_INVALID_CODE',
            message: 'User invalid code',
            metadata: payload,
        })
    }
}

export class UserNoCompleteCodeError extends DefaultError {
    constructor(payload: { id: string }) {
        super({
            code: 'USER_NO_COMPLETE_CODE',
            message: 'User no complete code',
            metadata: payload,
        })
    }
}

export class UserCompleteCodeTooEarlyError extends DefaultError {
    constructor(payload: { id: string }) {
        super({
            code: 'USER_COMPLETE_CODE_TOO_EARLY',
            message: 'User complete code too early',
            metadata: payload,
        })
    }
}

export class UserNotInModerationStateError extends DefaultError {
    constructor(payload: { id: string }) {
        super({
            code: 'USER_NOT_IN_MODERATION_STATE',
            message: 'User not in moderation state',
            metadata: payload,
        })
    }
}

export class PhotoNotFoundError extends DefaultError {
    constructor(payload: { id: string }) {
        super({
            code: 'PHOTO_NOT_FOUND',
            message: 'Photo not found',
            metadata: payload,
        })
    }
}

export class NoMainPhotoError extends DefaultError {
    constructor() {
        super({
            code: 'NO_MAIN_PHOTO',
            message: 'No main photo',
        })
    }
}

export class MultipleMainPhotosError extends DefaultError {
    constructor() {
        super({
            code: 'MULTIPLE_MAIN_PHOTOS',
            message: 'Multiple main photos',
        })
    }
}

export class PhotosLimitReachedError extends DefaultError {
    constructor() {
        super({
            code: 'PHOTOS_LIMIT_REACHED',
            message: 'Photos limit reached',
        })
    }
}

export class CannotBanSuperuserError extends DefaultError {
    constructor(payload: { id: string }) {
        super({
            code: 'CANNOT_BAN_SUPERUSER',
            message: 'Cannot ban superuser',
            metadata: payload,
        })
    }
}

export class CannotBanUserWithSameOrHigherRoleError extends DefaultError {
    constructor(payload: { userId: string; targetUserId: string }) {
        super({
            code: 'CANNOT_BAN_USER_WITH_SAME_OR_HIGHER_ROLE',
            message: 'Cannot ban user with same or higher role',
            metadata: payload,
        })
    }
}

export class UserSocialLinkNotFoundError extends DefaultError {
    constructor(payload: { id: string }) {
        super({
            code: 'USER_SOCIAL_LINK_NOT_FOUND',
            message: 'User social link not found',
            metadata: payload,
        })
    }
}
