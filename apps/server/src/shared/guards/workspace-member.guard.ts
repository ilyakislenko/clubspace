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

        const workspaceId = request?.params?.workspaceId ?? request?.body?.workspaceId

        if (!workspaceId) {
            throw new BadRequestError({ message: 'workspaceId is required' })
        }

        const membership = await this.prisma.workspaceMember.findUnique({
            where: {
                userId_workspaceId: {
                    userId: user.userId,
                    workspaceId,
                },
            },
            select: { id: true },
        })

        if (!membership) {
            throw new ForbiddenError({ message: 'Not a member of this workspace' })
        }

        return true
    }
}
