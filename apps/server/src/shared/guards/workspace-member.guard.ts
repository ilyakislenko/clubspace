import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'

import { PrismaService } from '../../infrastructure/prisma'
import { CurrentUserPayload } from '../decorators/current-user.decorator'
import { BadRequestError, ForbiddenError } from '../errors/shared.errors'

@Injectable()
export class WorkspaceMemberGuard implements CanActivate {
    constructor(private readonly prisma: PrismaService) {}

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
            throw new BadRequestError({ message: 'workspaceId is required' })
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
            throw new ForbiddenError({ message: 'Not a member of this workspace' })
        }

        if (membership.status !== 'ACTIVE') {
            throw new ForbiddenError({ message: 'Member is not active' })
        }

        if (membership.accessUntil && membership.accessUntil < new Date()) {
            throw new ForbiddenError({ message: 'Access window has expired' })
        }

        return true
    }
}
