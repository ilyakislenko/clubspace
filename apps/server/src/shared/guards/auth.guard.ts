import { ExecutionContext, Injectable, Logger } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { IncomingMessage } from 'http'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RolesService } from '../../domains/roles/services/roles.service'
import { TokensService } from '../../domains/tokens/services/tokens.service'
import { UsersService } from '../../domains/users/services/users.service'
import { environment } from '../../environments/environment'
import { UserStatus } from '../../infrastructure/prisma'
import { resolveRequestWorkspaceId } from '../access/resolve-workspace-id'
import {
    ACT_AS_ALLOWED,
    ACT_AS_HEADER,
} from '../decorators/act-as.decorator'
import { CurrentUserPayload } from '../decorators/current-user.decorator'
import { RoleFeature } from '../decorators/role-feature.decorator'
import {
    type RoleName,
    Roles,
    WORKSPACE_ADMINS,
} from '../decorators/roles.decorator'
import { SKIP_CONSENT_CHECK } from '../decorators/skip-consent-check.decorator'
import {
    BadRequestError,
    ConsentRequiredError,
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

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MEMBER_ROLE: RoleName = 'user'

@Injectable()
export class AuthGuard {
    private logger = new Logger()

    constructor(
        private readonly tokensService: TokensService,
        private readonly reflector: Reflector,
        private readonly rolesService: RolesService,
        private readonly usersService: UsersService,
        private readonly audit: AuditService,
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

            let decodedToken: { sub: string; sv: number } | undefined = undefined

            try {
                // Access tokens only: a refresh token is refused here.
                decodedToken = await this.tokensService.verifyToken(token)
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

            // 152-ФЗ: nothing past the consent screen until the current
            // edition of the personal-data consent is accepted. Runs before
            // any workspace resolution so every guard after this one sees an
            // account that may be processed.
            if (
                user.personalDataConsentVersion !==
                    environment.consent.personalDataVersion &&
                !this.reflector.getAllAndOverride<boolean | undefined>(
                    SKIP_CONSENT_CHECK,
                    [context.getHandler(), context.getClass()],
                )
            ) {
                throw new ConsentRequiredError()
            }

            // Never from the token: the club comes from the request, by the
            // same rule the member guard and the controllers use.
            const workspaceId = resolveRequestWorkspaceId(req)

            const actor = await this.resolveActAs(
                context,
                req,
                decodedToken.sub,
                workspaceId,
            )
            // The effective user: the dependent while a guardian acts for
            // them, else the signed-in person. Everything below (roles,
            // membership, handlers) sees only this one.
            const userId = actor?.dependentId ?? decodedToken.sub
            const isSuperAdmin = actor ? false : user.isSuperAdmin

            const basePayload: Partial<CurrentUserPayload> = {
                userId,
                workspaceId: workspaceId,
                isSuperAdmin,
                guardianId: actor ? decodedToken.sub : null,
            }

            if (isSuperAdmin) {
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
                    userId,
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
                            userId,
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
                        userId,
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

            if (error instanceof ConsentRequiredError) {
                throw error
            }

            this.logger.error(error)
            throw error
        }
    }

    // X-Act-As: a guardian acting for one of their dependents. Returns null
    // without the header. Refused unless the route is a member route of a
    // club (or explicitly @ActAsAllowed), is not staff-only, and the caller
    // holds a confirmed Guardianship over that dependent. The guardian never
    // gains anything the dependent itself couldn't do: from here on the
    // dependent is the effective user, with its own membership and role.
    private async resolveActAs(
        context: ExecutionContext,
        req: AuthenticatedRequest,
        guardianId: string,
        requestWorkspaceId: string | undefined,
    ): Promise<{ dependentId: string } | null> {
        const raw = req.headers?.[ACT_AS_HEADER]
        const header = (Array.isArray(raw) ? raw[0] : raw)?.trim()
        if (!header) return null

        if (!UUID_RE.test(header)) {
            throw new BadRequestError({ message: 'Некорректный профиль' })
        }

        const allowedHere =
            this.reflector.get<boolean | undefined>(
                ACT_AS_ALLOWED,
                context.getHandler(),
            ) === true
        if (!requestWorkspaceId && !allowedHere) {
            throw new ForbiddenError({
                message: 'В профиле ребёнка это действие недоступно',
            })
        }

        // Staff-only routes never accept act-as, whatever role the dependent
        // might hold in that club.
        const roles = this.reflector.getAllAndOverride(Roles, [
            context.getHandler(),
            context.getClass(),
        ])
        if (roles && roles.length > 0 && !roles.includes(MEMBER_ROLE)) {
            throw new ForbiddenError({
                message: 'В профиле ребёнка это действие недоступно',
            })
        }

        const linked = await this.usersService.isActiveGuardian({
            guardianId,
            dependentId: header,
        })
        if (!linked) {
            throw new ForbiddenError({ message: 'Нет доступа к этому профилю' })
        }

        // Every change made on a dependent's behalf is attributed to the
        // guardian. Reads are not recorded: they are the bulk of traffic and
        // change nothing.
        const method = (req.method ?? 'GET').toUpperCase()
        if (method !== 'GET' && method !== 'HEAD') {
            await this.audit.record({
                action: 'guardian.actAs',
                targetType: 'member',
                targetId: header,
                workspaceId: requestWorkspaceId ?? null,
                actorId: guardianId,
                metadata: { method, path: (req.url ?? '').split('?')[0] },
            })
        }

        return { dependentId: header }
    }
}
