import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'

import { Reflector } from '@nestjs/core'

import { PrismaService } from '../../infrastructure/prisma'
import { ALLOW_EXPIRED_ACCESS } from '../decorators/allow-expired-access.decorator'
import { CurrentUserPayload } from '../decorators/current-user.decorator'
import { BadRequestError, ForbiddenError } from '../errors/shared.errors'

@Injectable()
export class WorkspaceMemberGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly prisma: PrismaService,
    ) {}

    async canActivate(context: ExecutionContext) {
        const request = context.switchToHttp().getRequest()
        const user = request?.user as CurrentUserPayload | undefined

        if (!user?.userId) {
            throw new ForbiddenError()
        }

        const workspaceId =
            request?.params?.workspaceId ??
            request?.body?.workspaceId ??
            request?.query?.workspaceId

        if (!workspaceId) {
            throw new BadRequestError({ message: 'Не указан клуб' })
        }

        // Platform staff pass without a membership row. Every other authz layer
        // already treats isSuperAdmin as global admin — RoleGuard admits them
        // whatever @Roles says, and RbacService.resolveCoachScope hands them
        // 'admin' scope in any workspace — so this guard was the one door left
        // shut: a platform admin opening a club they had not joined got 403 on
        // every endpoint while nominally having full rights over it. Checked
        // before the DB round-trip since the answer can't depend on it.
        if (user.isSuperAdmin) {
            return true
        }

        const [workspace, membership] = await Promise.all([
            this.prisma.workspace.findUnique({
                where: { id: workspaceId },
                select: { ownerId: true },
            }),
            this.prisma.workspaceMember.findUnique({
                where: {
                    userId_workspaceId: {
                        userId: user.userId,
                        workspaceId,
                    },
                },
                select: { id: true, status: true, accessUntil: true },
            }),
        ])

        // Owner bypasses status/access checks so they can never lock themselves
        // out — and the normal workspace-creation flow leaves the owner without
        // a membership row, so this must precede the existence check below.
        if (workspace?.ownerId === user.userId) {
            return true
        }

        if (!membership) {
            throw new ForbiddenError({ message: 'Вы не участник этого клуба' })
        }

        if (membership.status !== 'ACTIVE') {
            throw new ForbiddenError({ message: 'Участник неактивен' })
        }

        // A route marked @AllowExpiredAccess skips only this check.
        const allowExpired =
            this.reflector.get<boolean | undefined>(
                ALLOW_EXPIRED_ACCESS,
                context.getHandler(),
            ) === true
        if (
            !allowExpired &&
            membership.accessUntil &&
            membership.accessUntil < new Date()
        ) {
            throw new ForbiddenError({ message: 'Срок доступа истёк' })
        }

        return true
    }
}
