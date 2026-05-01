import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import {
    RemoveWorkspaceMemberFeature,
    RemoveWorkspaceMemberFeatureResponse,
} from './remove-workspace-member.feature'

@Feature(RemoveWorkspaceMemberFeature)
export class RemoveWorkspaceMemberHandler
    implements
        IFeatureHandler<
            RemoveWorkspaceMemberFeature,
            RemoveWorkspaceMemberFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({
        workspaceId,
        userId,
        invokerUserId,
    }: RemoveWorkspaceMemberFeature) {
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { ownerId: true },
        })

        if (!workspace) {
            throw new NotFoundError({ message: 'Workspace not found' })
        }

        if (workspace.ownerId !== invokerUserId) {
            throw new ForbiddenError({
                message: 'Only workspace owner can remove members',
            })
        }

        if (userId === workspace.ownerId) {
            throw new BadRequestError({
                message: 'Cannot remove workspace owner',
            })
        }

        const member = await this.prisma.workspaceMember.findUnique({
            where: {
                userId_workspaceId: { userId, workspaceId },
            },
            select: { id: true },
        })

        if (!member) {
            throw new NotFoundError({ message: 'Member not found' })
        }

        await this.prisma.workspaceMember.delete({
            where: { id: member.id },
        })

        return { status: 'removed' as const }
    }
}
