import { DefaultError } from '../../../shared/errors/default.error'

export class EmailTemplateNotFoundError extends DefaultError {
    constructor(payload: { key: string }) {
        super({
            code: 'EMAIL_TEMPLATE_NOT_FOUND',
            message: `Шаблон письма «${payload.key}» не найден`,
            metadata: payload,
        })
    }
}

export class EmailTemplateRenderError extends DefaultError {
    constructor(payload: { key: string; error: string }) {
        super({
            code: 'EMAIL_TEMPLATE_RENDER_ERROR',
            message: `Не удалось собрать письмо по шаблону «${payload.key}»: ${payload.error}`,
            metadata: payload,
        })
    }
}
