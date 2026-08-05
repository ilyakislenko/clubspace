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
import { RoleFeaturesEnum } from '../interfaces/shared.intefaces'
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

            const user = await this.usersService.getUserById({
                id: decodedToken.sub,
            })

            if (user.status === UserStatus.BLOCKED) {
                throw new UserBlockedError()
            }

            if (user.status === UserStatus.DELETED) {
                throw new UnauthorizedError()
            }

            const workspaceId: string | undefined =
                decodedToken.workspaceId ||
                (req as any).params?.workspaceId ||
                (req as any).body?.workspaceId ||
                // Admin video routes (@Controller('admin/videos')) carry the
                // workspace as a query param; without this the role never
                // resolves there, so @Roles guards reject every non-superadmin
                // (matches WorkspaceMemberGuard, which already reads query).
                (req as any).query?.workspaceId

            const basePayload: Partial<CurrentUserPayload> = {
                userId: decodedToken.sub,
                workspaceId: workspaceId,
                isSuperAdmin: user.isSuperAdmin,
            }

            if (user.isSuperAdmin) {
                ;(req as any).user = {
                    ...basePayload,
                    role: {
                        id: 'super-admin',
                        name: 'super-admin',
                        superuser: true,
                    },
                    permissions: [],
                } as CurrentUserPayload

                return req
            }

            if (!workspaceId) {
                ;(req as any).user = {
                    ...basePayload,
                    role: null,
                    permissions: [],
                } as CurrentUserPayload

                const featureKey = this.reflector.get(
                    RoleFeature,
                    context.getHandler(),
                )

                // Если требуется feature - значит нужен workspace
                if (featureKey) {
                    throw new ForbiddenError({ message: 'Не указан клуб' })
                }

                return req
            }

            let role: any
            try {
                role = await this.rolesService.getRole({
                    userId: decodedToken.sub,
                    workspaceId,
                })
            } catch {
                throw new ForbiddenError({ message: 'Вы не участник этого клуба' })
            }

            ;(req as any).user = {
                ...basePayload,
                role: {
                    id: role.id,
                    name: role.name,
                    superuser: role.superuser,
                },
                permissions: role.features,
            } as CurrentUserPayload

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
                (feature: { key: RoleFeaturesEnum }) => feature.key === featureKey,
            )

            if (!permission || !permission.allowed) {
                throw new ForbiddenError({ message: 'Недостаточно прав' })
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
