import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ListWorkspaceInvitationsFeature,
    ListWorkspaceInvitationsFeatureResponse,
} from './list-workspace-invitations.feature'
import { serializeWorkspaceInvitation } from './schemas'

// «Ожидают принятия»: offers the club sent to existing accounts.
@Feature(ListWorkspaceInvitationsFeature)
export class ListWorkspaceInvitationsHandler
    implements
        IFeatureHandler<
            ListWorkspaceInvitationsFeature,
            ListWorkspaceInvitationsFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute({
        workspaceId,
        invokerUserId,
        roleName,
        isSuperAdmin,
    }: ListWorkspaceInvitationsFeature): Promise<ListWorkspaceInvitationsFeatureResponse> {
        await assertWorkspaceAdmin(
            this.rbac,
            { userId: invokerUserId, workspaceId, roleName, isSuperAdmin },
            'Приглашения видит только администратор клуба',
        )
        const rows = await this.prisma.workspaceInvitation.findMany({
            where: { workspaceId },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                roleName: true,
                groupId: true,
                createdAt: true,
                user: { select: { email: true } },
            },
        })
        return { data: rows.map(serializeWorkspaceInvitation) }
    }
}
