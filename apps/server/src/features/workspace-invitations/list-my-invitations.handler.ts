import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    ListMyInvitationsFeature,
    ListMyInvitationsFeatureResponse,
} from './list-my-invitations.feature'
import { serializeMyInvitation } from './schemas'

// Offers waiting for the caller, newest first. Clubs that are switched off are
// left out: accepting would be refused anyway.
@Feature(ListMyInvitationsFeature)
export class ListMyInvitationsHandler
    implements
        IFeatureHandler<ListMyInvitationsFeature, ListMyInvitationsFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({
        invokerUserId,
    }: ListMyInvitationsFeature): Promise<ListMyInvitationsFeatureResponse> {
        const rows = await this.prisma.workspaceInvitation.findMany({
            where: { userId: invokerUserId, workspace: { isActive: true } },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: {
                id: true,
                roleName: true,
                groupId: true,
                createdAt: true,
                workspace: { select: { id: true, name: true, type: true } },
            },
        })
        const groupIds = [
            ...new Set(rows.flatMap((r) => (r.groupId ? [r.groupId] : []))),
        ]
        const groups = groupIds.length
            ? await this.prisma.group.findMany({
                  where: { id: { in: groupIds } },
                  select: { id: true, name: true, workspaceId: true },
              })
            : []
        // A group id only counts inside the inviting club.
        const groupName = new Map(
            groups.map((g) => [`${g.workspaceId}:${g.id}`, g.name]),
        )
        return {
            data: rows.map((r) =>
                serializeMyInvitation(
                    r,
                    r.groupId
                        ? (groupName.get(`${r.workspace.id}:${r.groupId}`) ?? null)
                        : null,
                ),
            ),
        }
    }
}
