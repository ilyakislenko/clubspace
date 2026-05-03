import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    GetMyWorkspaceMembershipFeature,
    GetMyWorkspaceMembershipFeatureResponse,
} from './get-my-workspace-membership.feature'

@Feature(GetMyWorkspaceMembershipFeature)
export class GetMyWorkspaceMembershipHandler
    implements
        IFeatureHandler<
            GetMyWorkspaceMembershipFeature,
            GetMyWorkspaceMembershipFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({
        workspaceId,
        userId,
    }: GetMyWorkspaceMembershipFeature) {
        const member = await this.prisma.workspaceMember.findUnique({
            where: {
                userId_workspaceId: { userId, workspaceId },
            },
            include: {
                workspace: { select: { name: true, ownerId: true } },
                role: { select: { name: true } },
            },
        })

        if (!member) {
            throw new NotFoundError({ message: 'Membership not found' })
        }

        return {
            workspaceId,
            workspaceName: member.workspace.name,
            role: member.role.name,
            status: member.status,
            accessUntil: member.accessUntil
                ? member.accessUntil.toISOString()
                : null,
            isOwner: member.workspace.ownerId === userId,
            createdAt: member.createdAt.toISOString(),
        }
    }
}
