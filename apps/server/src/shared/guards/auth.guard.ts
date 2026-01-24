import { ExecutionContext, Injectable, Logger } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { IncomingMessage } from 'http'

import { RolesService } from '../../domains/roles/services/roles.service'
import { TokensService } from '../../domains/tokens/services/tokens.service'
import { UsersService } from '../../domains/users/services/users.service'
import { UserStatus } from '../../infrastructure/prisma'
import { CurrentUserPayload } from '../decorators/current-user.decorator'
import { RoleFeature } from '../decorators/role-feature.decorator'
import {
    BadRequestError,
    ForbiddenError,
    UnauthorizedError,
    UserBlockedError,
} from '../errors/shared.errors'
import { extractToken } from '../utils/extract-token.util'

@Injectable()
export class AuthGuard {
    private logger = new Logger()

    constructor(
        private readonly tokensService: TokensService,
        private readonly reflector: Reflector,
        private readonly rolesService: RolesService,
        private readonly usersService: UsersService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<IncomingMessage> {
        try {
            const req = context.switchToHttp().getRequest<IncomingMessage>()
            const token = extractToken(req)

            if (!token) {
                throw new UnauthorizedError()
            }

            let decodedToken:
                | {
                      sub: string
                      workspaceId?: string
                  }
                | undefined = undefined

            try {
                decodedToken = await this.tokensService.verifyToken<{
                    sub: string
                    workspaceId?: string
                }>(token)
            } catch {
                throw new UnauthorizedError()
            }

            const role = await this.rolesService.getRole({
                userId: decodedToken.sub,
            })

            const user = await this.usersService.getUserById({
                id: decodedToken.sub,
            })

            ;(req as any).user = {
                userId: decodedToken.sub,
                workspaceId: decodedToken.workspaceId,
                role: {
                    id: role.id,
                    name: role.name,
                    superuser: role.superuser,
                },
                permissions: role.features,
            } as CurrentUserPayload

            if (user.status === UserStatus.BLOCKED) {
                throw new UserBlockedError()
            }

            if (user.status === UserStatus.DELETED) {
                throw new UnauthorizedError()
            }

            if (role.superuser) {
                return req
            }

            const featureKey = this.reflector.get(
                RoleFeature,
                context.getHandler(),
            )

            if (!featureKey) {
                return req
            }

            const permission = role.features.find(
                (feature) => feature.key === featureKey,
            )

            if (!permission || (permission && !permission.allowed)) {
                throw new ForbiddenError()
            }

            return req
        } catch (error) {
            if (error instanceof UnauthorizedError) {
                throw error
            }

            if (error instanceof ForbiddenError) {
                throw error
            }

            if (error instanceof BadRequestError) {
                throw error
            }

            this.logger.error(error)
            throw error
        }
    }
}
