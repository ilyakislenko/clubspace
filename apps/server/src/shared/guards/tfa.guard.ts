import { ExecutionContext, Injectable, Logger } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { IncomingMessage } from 'http'

import { TfaAuthenticatorService } from '../../domains/tfa/services/tfa-authenticator.service'
import { TfaService } from '../../domains/tfa/services/tfa.service'
import { TokensService } from '../../domains/tokens/services/tokens.service'
import { UserNotFoundError } from '../../domains/users/errors/users.errors'
import { UsersService } from '../../domains/users/services/users.service'
import { TfaGroup } from '../decorators'
import { DefaultError } from '../errors/default.error'
import { UnauthorizedError, UnexpectedError } from '../errors/shared.errors'

@Injectable()
export class TfaGuard {
    private logger = new Logger()

    constructor(
        private readonly usersService: UsersService,
        private readonly tokensService: TokensService,
        private readonly reflector: Reflector,
        private readonly tfaAuthenticatorService: TfaAuthenticatorService,
        private readonly tfaService: TfaService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<IncomingMessage> {
        try {
            const req = context.switchToHttp().getRequest<IncomingMessage>()

            const groupKey = this.reflector.get(TfaGroup, context.getHandler())

            if (!groupKey) {
                return req
            }

            const userId = await this.extractUserId(req)

            if (!userId) {
                throw new UnauthorizedError()
            }

            const userTfaMethods = await this.tfaService.getTfaMethods({
                userId,
                onlyEnabled: true,
            })

            for (const tfaMethod of userTfaMethods) {
                const permission = tfaMethod.tfaPermissions.find(
                    (permission) => permission.group.key === groupKey,
                )

                if (!permission) {
                    throw new UnexpectedError({
                        message: `Разрешение для группы ${groupKey} не найдено`,
                    })
                }

                if (!permission.enabled && !permission.group.alwaysEnabled) {
                    return req
                }

                const tfaCode: string | undefined = req.headers[
                    `tfa-${tfaMethod.type.toLowerCase()}`
                ] as string | undefined

                if (!tfaCode) {
                    throw new TfaCodeRequiredError()
                }

                const isValid = await this.tfaAuthenticatorService.verifyCode({
                    userId,
                    code: tfaCode,
                })

                if (!isValid) {
                    throw new TfaCodeInvalidError()
                }

                return req
            }

            return req
        } catch (error) {
            if (error instanceof TfaCodeRequiredError) {
                throw error
            }

            if (error instanceof TfaCodeInvalidError) {
                throw error
            }

            this.logger.error(error)
            throw error
        }
    }

    private async extractUserId(request: IncomingMessage) {
        let token: string | undefined = undefined

        try {
            const authorization = request.headers.authorization

            if (authorization) {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const [_, tokenFromHeaders] = authorization.split(' ')

                token = tokenFromHeaders
            }
        } catch {
            // skip
        }

        try {
            const authorization = request as unknown as {
                connectionParams: { Authorization: string }
            }['connectionParams']['Authorization']

            if (authorization) {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const [_, tokenFromHeaders] = authorization.split(' ')

                token = tokenFromHeaders
            }
        } catch {
            // skip
        }

        let email: string | undefined = undefined
        try {
            if (
                request.method === 'POST' &&
                request.headers['content-type']?.includes('application/json')
            ) {
                if (
                    (request as any).body &&
                    typeof (request as any).body === 'object'
                ) {
                    email = (request as any).body.email
                } else if ((request as any).rawBody) {
                    try {
                        const bodyObj = JSON.parse((request as any).rawBody)
                        email = bodyObj.email
                    } catch {
                        // skip
                    }
                }
            }
        } catch {
            // skip
        }

        if (token) {
            try {
                const { sub } = await this.tokensService.decodeToken<{
                    sub: string
                }>(token)

                return sub
            } catch {
                // skip
            }
        }

        if (email) {
            const user = await this.usersService.getUserByEmail({ email })

            if (!user) {
                throw new UserNotFoundError({ email })
            }

            return user.id
        }

        return undefined
    }
}

export class TfaCodeRequiredError extends DefaultError {
    constructor() {
        super({
            code: 'TFA_CODE_REQUIRED',
            message: 'Нужен код двухфакторной проверки',
        })
    }
}

export class TfaCodeInvalidError extends DefaultError {
    constructor() {
        super({
            code: 'TFA_CODE_INVALID',
            message: 'Неверный код двухфакторной проверки',
        })
    }
}
