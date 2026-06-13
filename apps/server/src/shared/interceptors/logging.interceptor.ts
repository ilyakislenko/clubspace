/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
    CallHandler,
    ExecutionContext,
    HttpException,
    Injectable,
    Logger,
    NestInterceptor,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { randomUUID } from 'crypto'
import { get } from 'env-var'
import { Request, Response } from 'express'
import { ZodSerializationException, ZodValidationException } from 'nestjs-zod'
import { Observable, throwError } from 'rxjs'
import { catchError, tap } from 'rxjs/operators'
import { ZodError } from 'zod'
import { DefaultError } from '../errors/default.error'
import {
    BadRequestError,
    NotFoundError,
    UnexpectedError,
} from '../errors/shared.errors'
import { extractToken } from '../utils/extract-token.util'
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/client'

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
    private readonly logger = new Logger(LoggingInterceptor.name)

    constructor(private readonly jwtService: JwtService) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const now = Date.now()

        const ctx = context.switchToHttp()
        const request = ctx.getRequest<Request>()

        const body = {
            ...request.body,
        }

        if (body && typeof body === 'object' && 'code' in body) {
            body.code = 'MASKED'
        }

        if (body && typeof body === 'object' && 'password' in body) {
            body.password = 'MASKED'
        }

        if (body && typeof body === 'object' && 'secret' in body) {
            body.secret = 'MASKED'
        }

        const data: {
            path: string
            body: Record<string, unknown>
            userId?: string
            params: Record<string, unknown>
            query: Record<string, unknown>
            duration?: number
            requestId?: string
            error?: {
                statusCode: number
                message: string
                code: string
                errorId: string
                metadata?: Record<string, unknown>
                stack?: string
            }
        } = {
            path: request.url,
            body: body,
            params: request.params,
            query: request.query,
            duration: undefined,
            requestId: undefined,
        }

        const token = extractToken(request)

        if (token) {
            try {
                const { sub } = this.jwtService.decode(token) as { sub: string }

                data.userId = sub
            } catch {
                // skip
            }
        }

        const logger = this.logger

        return next.handle().pipe(
            tap(() => {
                const response = ctx.getResponse<Response>()

                const requestId =
                    (response.getHeader('X-Request-Id') as string) ||
                    randomUUID()
                response.setHeader('X-Request-Id', requestId)

                const duration = Date.now() - now

                data.duration = duration
                data.requestId = requestId

                logger.debug(data)
            }),
            catchError((exception) => {
                let error: DefaultError
                const response = ctx.getResponse<Response>()

                const message =
                    exception instanceof Error
                        ? exception.message
                        : 'Unexpected error'

                error = new UnexpectedError({
                    message,
                })

                if (exception instanceof PrismaClientKnownRequestError) {
                    if (exception.code == 'P2003') {
                        error = new NotFoundError({
                            message: `Foreign key constraint violated on the constraint: ${exception.meta?.modelName}`,
                        })
                    }

                    if (exception.code == 'P2025') {
                        error = new NotFoundError({
                            message: `Record not found: ${exception.meta?.modelName}`,
                        })
                    }
                }

                if (exception instanceof HttpException) {
                    error = new DefaultError({
                        code: exception.getStatus().toString(),
                        message: exception.message,
                        statusCode: exception.getStatus(),
                    })
                }

                if (exception instanceof ZodSerializationException) {
                    const zodError = exception.getZodError()

                    if (zodError instanceof ZodError) {
                        this.logger.error(
                            `ZodSerializationException: ${zodError.message}`,
                        )
                    }
                }

                if (exception instanceof ZodValidationException) {
                    const zodError = exception.getZodError() as ZodError

                    const message = zodError.issues
                        .map((issue) => issue.message)
                        .join(', ')

                    error = new BadRequestError({
                        message,
                    })
                }

                if (exception instanceof DefaultError) {
                    error = exception
                }

                const isProduction = get('NODE_ENV').asString() === 'production'

                data.error = {
                    statusCode: error.statusCode,
                    message: error.message,
                    code: error.code,
                    errorId: error.id,
                    metadata: error.metadata,
                    stack: !isProduction
                        ? (exception as Error)?.stack
                        : undefined,
                }

                const requestId =
                    (response.getHeader('X-Request-Id') as string) ||
                    randomUUID()
                response.setHeader('X-Request-Id', requestId)

                const duration = Date.now() - now

                data.duration = duration
                data.requestId = requestId

                if (error.statusCode < 400 || error.statusCode >= 500) {
                    this.logger.error(data)
                } else {
                    this.logger.debug(data)
                }

                // The full message/metadata is logged above for debugging, but
                // raw server-side errors (Prisma/S3/driver messages surfaced as
                // 5xx) must not reach the client in production. Send a generic
                // body for 5xx in prod; 4xx domain errors keep their
                // intentional, user-facing messages.
                const clientError =
                    isProduction && error.statusCode >= 500
                        ? {
                              statusCode: error.statusCode,
                              message: 'Internal server error',
                              code: error.code,
                              errorId: error.id,
                          }
                        : data.error!

                return throwError(
                    () =>
                        new HttpException(
                            clientError,
                            clientError.statusCode,
                            // Preserve the original error as the cause so the
                            // exception filter reports IT (real type + stack)
                            // to Sentry, not this wrapper.
                            {
                                cause:
                                    exception instanceof Error
                                        ? exception
                                        : undefined,
                            },
                        ),
                )
            }),
        )
    }
}
