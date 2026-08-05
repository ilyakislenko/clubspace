import { DefaultError } from '../../../shared/errors/default.error'

export class TelegramAccountNotSpecifiedError extends DefaultError {
    constructor() {
        super({
            message: 'Не указан Telegram-аккаунт',
            code: 'TELEGRAM_ACCOUNT_NOT_SPECIFIED',
            statusCode: 400,
        })
    }
}

export class EmailNotSpecifiedError extends DefaultError {
    constructor() {
        super({
            message: 'Не указан email',
            code: 'EMAIL_NOT_SPECIFIED',
            statusCode: 400,
        })
    }
}
