import { DefaultError } from '../../../shared/errors/default.error';

export class UserNotFoundError extends DefaultError {
    constructor(payload: { id?: string; email?: string }) {
        const message = payload.email
            ? `Пользователь с email ${payload.email} не найден`
            : `Пользователь ${payload.id} не найден`

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
            message: 'Аккаунт уже активирован',
            metadata: payload,
        })
    }
}

export class UserInvalidCodeError extends DefaultError {
    constructor(payload: { id: string }) {
        super({
            code: 'USER_INVALID_CODE',
            message: 'Неверный код',
            metadata: payload,
        })
    }
}

export class UserNoCompleteCodeError extends DefaultError {
    constructor(payload: { id: string }) {
        super({
            code: 'USER_NO_COMPLETE_CODE',
            message: 'Код не запрашивался — запросите новый',
            metadata: payload,
        })
    }
}

export class UserCompleteCodeTooEarlyError extends DefaultError {
    constructor(payload: { id: string }) {
        super({
            code: 'USER_COMPLETE_CODE_TOO_EARLY',
            message: 'Новый код можно запросить чуть позже',
            metadata: payload,
        })
    }
}

export class UserNotInModerationStateError extends DefaultError {
    constructor(payload: { id: string }) {
        super({
            code: 'USER_NOT_IN_MODERATION_STATE',
            message: 'Пользователь не на модерации',
            metadata: payload,
        })
    }
}

export class PhotoNotFoundError extends DefaultError {
    constructor(payload: { id: string }) {
        super({
            code: 'PHOTO_NOT_FOUND',
            message: 'Фото не найдено',
            metadata: payload,
        })
    }
}

export class NoMainPhotoError extends DefaultError {
    constructor() {
        super({
            code: 'NO_MAIN_PHOTO',
            message: 'Не выбрано главное фото',
        })
    }
}

export class MultipleMainPhotosError extends DefaultError {
    constructor() {
        super({
            code: 'MULTIPLE_MAIN_PHOTOS',
            message: 'Главным можно сделать только одно фото',
        })
    }
}

export class PhotosLimitReachedError extends DefaultError {
    constructor() {
        super({
            code: 'PHOTOS_LIMIT_REACHED',
            message: 'Достигнут лимит фотографий',
        })
    }
}

export class CannotBanSuperuserError extends DefaultError {
    constructor(payload: { id: string }) {
        super({
            code: 'CANNOT_BAN_SUPERUSER',
            message: 'Нельзя заблокировать суперпользователя',
            metadata: payload,
        })
    }
}

export class CannotBanUserWithSameOrHigherRoleError extends DefaultError {
    constructor(payload: { userId: string; targetUserId: string }) {
        super({
            code: 'CANNOT_BAN_USER_WITH_SAME_OR_HIGHER_ROLE',
            message: 'Нельзя заблокировать пользователя с равной или большей ролью',
            metadata: payload,
        })
    }
}

export class UserSocialLinkNotFoundError extends DefaultError {
    constructor(payload: { id: string }) {
        super({
            code: 'USER_SOCIAL_LINK_NOT_FOUND',
            message: 'Ссылка на соцсеть не найдена',
            metadata: payload,
        })
    }
}


