import { ExecutionContext, Injectable, Logger } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { IncomingMessage } from 'http'

import { RolesService } from '../../domains/roles/services/roles.service'
import { TokensService } from '../../domains/tokens/services/tokens.service'
import { UsersService } from '../../domains/users/services/users.service'
import { UserStatus } from '../../infrastructure/prisma'
import { CurrentUserPayload } from '../decorators/current-user.decorator'
import { RoleFeature } from '../decorators/role-feature.decorator'
import { type RoleName, WORKSPACE_ADMINS } from '../decorators/roles.decorator'
import {
    BadRequestError,
    ForbiddenError,
    UnauthorizedError,
    UserBlockedError,
} from '../errors/shared.errors'
import { AuthenticatedRequest } from '../interfaces/authenticated-request.interface'
import { extractToken } from '../utils/extract-token.util'

// Both role lookups return the same shape; derive it instead of restating it.
type ResolvedRole = NonNullable<
    Awaited<ReturnType<RolesService['getRoleForWorkspaceOwner']>>
>

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
            const req = context
                .switchToHttp()
                .getRequest<AuthenticatedRequest>()
            const token = extractToken(req)

            if (!token) {
                throw new UnauthorizedError()
            }

            let decodedToken:
                | {
                      sub: string
                      sv: number
                      workspaceId?: string
                  }
                | undefined = undefined

            try {
                // Access tokens only: a refresh token is refused here.
                decodedToken = await this.tokensService.verifyToken<{
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

            // Sessions ended after this token was issued (sign out everywhere,
            // email change, account deletion). The user row is read for every
            // request anyway, so this costs nothing extra.
            if (decodedToken.sv !== user.sessionVersion) {
                throw new UnauthorizedError()
            }

            const workspaceId: string | undefined =
                decodedToken.workspaceId ||
                req.params?.workspaceId ||
                req.body?.workspaceId ||
                // Admin video routes (@Controller('admin/videos')) carry the
                // workspace as a query param; without this the role never
                // resolves there, so @Roles guards reject every non-superadmin
                // (matches WorkspaceMemberGuard, which already reads query).
                req.query?.workspaceId

            const basePayload: Partial<CurrentUserPayload> = {
                userId: decodedToken.sub,
                workspaceId: workspaceId,
                isSuperAdmin: user.isSuperAdmin,
            }

            if (user.isSuperAdmin) {
                req.user = {
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
                req.user = {
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

            let role: ResolvedRole
            try {
                const memberRole = await this.rolesService.getRole({
                    userId: decodedToken.sub,
                    workspaceId,
                })
                role = memberRole
                // The member row's role wins, but an owner must never be
                // weaker than a workspace admin: owners promoted from coach
                // (or given a plain `user` row by an import) would otherwise
                // be refused by RoleGuard on every admin route of their own
                // club. Same resolution as the no-row path below.
                if (
                    memberRole.isWorkspaceOwner &&
                    !WORKSPACE_ADMINS.includes(memberRole.name as RoleName)
                ) {
                    const ownerRole =
                        await this.rolesService.getRoleForWorkspaceOwner({
                            userId: decodedToken.sub,
                            workspaceId,
                        })
                    if (ownerRole) role = ownerRole
                }
            } catch {
                // A club owner may have no WorkspaceMember row of their own —
                // ownership lives in Workspace.ownerId, and every membership
                // gate is written to special-case it. This one wasn't: getRole
                // throws for a missing membership and the owner was refused
                // with "Вы не участник этого клуба" on their own club, before
                // WorkspaceMemberGuard's owner bypass ever ran.
                //
                // Today the platform console happens to create the row when it
                // hands a club over, so the path is not reachable from the UI
                // — but the invariant is upheld by one call site rather than
                // by the guard, and RoleGuard's own comment already claims
                // owners always pass, which was untrue.
                //
                // Resolve the real 'admin' role rather than synthesising a
                // permission set: the owner then gets exactly what a workspace
                // admin gets, and there is no second definition of "owner
                // rights" to drift out of sync.
                const ownerRole =
                    await this.rolesService.getRoleForWorkspaceOwner({
                        userId: decodedToken.sub,
                        workspaceId,
                    })
                if (!ownerRole) {
                    throw new ForbiddenError({
                        message: 'Вы не участник этого клуба',
                    })
                }
                role = ownerRole
            }

            req.user = {
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
                (feature) => feature.key === featureKey,
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
