import { DefaultError } from '../../../shared/errors/default.error'

export class EmailTemplateNotFoundError extends DefaultError {
    constructor(payload: { key: string }) {
        super({
            code: 'EMAIL_TEMPLATE_NOT_FOUND',
            message: `Email template with key ${payload.key} not found`,
            metadata: payload,
        })
    }
}

export class EmailTemplateRenderError extends DefaultError {
    constructor(payload: { key: string; error: string }) {
        super({
            code: 'EMAIL_TEMPLATE_RENDER_ERROR',
            message: `Failed to render email template with key ${payload.key}: ${payload.error}`,
            metadata: payload,
        })
    }
}
