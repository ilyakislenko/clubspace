import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    ListWorkspaceMembersFeature,
    ListWorkspaceMembersFeatureResponse,
} from './list-workspace-members.feature'

@Feature(ListWorkspaceMembersFeature)
export class ListWorkspaceMembersHandler
    implements
        IFeatureHandler<
            ListWorkspaceMembersFeature,
            ListWorkspaceMembersFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ workspaceId }: ListWorkspaceMembersFeature) {
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { ownerId: true },
        })

        if (!workspace) {
            throw new NotFoundError({ message: 'Workspace not found' })
        }

        const members = await this.prisma.workspaceMember.findMany({
            where: { workspaceId },
            orderBy: { createdAt: 'asc' },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstname: true,
                        lastname: true,
                    },
                },
                role: { select: { name: true } },
            },
        })

        return {
            data: members.map((member) => ({
                id: member.id,
                userId: member.user.id,
                email: member.user.email,
                firstname: member.user.firstname,
                lastname: member.user.lastname,
                status: member.status,
                roleName: member.role.name,
                isOwner: member.user.id === workspace.ownerId,
                accessUntil: member.accessUntil
                    ? member.accessUntil.toISOString()
                    : null,
                createdAt: member.createdAt.toISOString(),
            })),
            total: members.length,
        }
    }
}
