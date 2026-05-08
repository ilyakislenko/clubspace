import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    Logger,
} from '@nestjs/common'
import { Response } from 'express'

import { DefaultError } from '../errors/default.error'

// Maps our domain DefaultError tree onto HTTP responses with the right
// statusCode. Without this, every DefaultError surfaces as 500 because
// it doesn't extend HttpException — which is what made the admin's 401
// refresh flow silently never fire (the intercepted error was a 500).
@Catch()
export class DefaultErrorFilter implements ExceptionFilter {
    private readonly logger = new Logger(DefaultErrorFilter.name)

    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp()
        const response = ctx.getResponse<Response>()

        if (exception instanceof DefaultError) {
            response.status(exception.statusCode).json({
                statusCode: exception.statusCode,
                code: exception.code,
                message: exception.message,
                metadata: exception.metadata,
            })
            return
        }

        if (exception instanceof HttpException) {
            const status = exception.getStatus()
            const body = exception.getResponse()
            response
                .status(status)
                .json(typeof body === 'string' ? { message: body } : body)
            return
        }

        this.logger.error(exception)
        response.status(500).json({
            statusCode: 500,
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Internal server error',
        })
    }
}
