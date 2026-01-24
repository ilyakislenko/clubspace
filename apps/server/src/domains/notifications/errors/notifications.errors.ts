import { DefaultError } from '../../../shared/errors/default.error'

export class TelegramAccountNotSpecifiedError extends DefaultError {
    constructor() {
        super({
            message: 'Telegram account is not specified',
            code: 'TELEGRAM_ACCOUNT_NOT_SPECIFIED',
            statusCode: 400,
        })
    }
}

export class EmailNotSpecifiedError extends DefaultError {
    constructor() {
        super({
            message: 'Email is not specified',
            code: 'EMAIL_NOT_SPECIFIED',
            statusCode: 400,
        })
    }
}
