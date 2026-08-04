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
        isSuperAdmin,
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
            return this.effectiveMembership(workspaceId, userId, isSuperAdmin)
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

    // Two callers legitimately have no WorkspaceMember row yet still hold full
    // rights, and both used to get a 404 here: the workspace **owner** (the
    // documented "owner has no member row" case) and a **platform super
    // admin**. Clients gate their admin controls on this endpoint
    // (`isWorkspaceAdmin(useMyMembership(...))`), so a 404 rendered a read-only
    // screen for people the server would happily let write.
    //
    // The synthetic row reports the access the server actually enforces —
    // RbacService grants both of them 'admin' scope — rather than inventing
    // rights. Anyone else still gets a 404.
    private async effectiveMembership(
        workspaceId: string,
        userId: string,
        isSuperAdmin: boolean,
    ) {
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { name: true, ownerId: true, createdAt: true },
        })

        if (!workspace) {
            throw new NotFoundError({ message: 'Workspace not found' })
        }

        const isOwner = workspace.ownerId === userId
        if (!isOwner && !isSuperAdmin) {
            throw new NotFoundError({ message: 'Membership not found' })
        }

        return {
            workspaceId,
            workspaceName: workspace.name,
            role: 'admin',
            status: 'ACTIVE',
            accessUntil: null,
            isOwner,
            createdAt: workspace.createdAt.toISOString(),
        }
    }
}
