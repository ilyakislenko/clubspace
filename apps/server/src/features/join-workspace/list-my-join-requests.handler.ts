import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    ListMyJoinRequestsFeature,
    ListMyJoinRequestsFeatureResponse,
} from './list-my-join-requests.feature'

@Feature(ListMyJoinRequestsFeature)
export class ListMyJoinRequestsHandler
    implements
        IFeatureHandler<
            ListMyJoinRequestsFeature,
            ListMyJoinRequestsFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    // Memberships that are not (yet) a way in: waiting for an admin, or turned
    // down. get-my-workspaces only lists ACTIVE ones, so this is how the app
    // can say "your request is pending" instead of staying silent.
    async execute({ invokerUserId }: ListMyJoinRequestsFeature) {
        const rows = await this.prisma.workspaceMember.findMany({
            where: {
                userId: invokerUserId,
                status: { in: ['INVITED', 'BLOCKED', 'SUSPENDED'] },
                workspace: { isActive: true },
            },
            select: {
                status: true,
                createdAt: true,
                workspace: { select: { id: true, name: true, key: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 20,
        })

        return {
            data: rows.map((r) => ({
                workspaceId: r.workspace.id,
                workspaceName: r.workspace.name,
                workspaceKey: r.workspace.key,
                status:
                    r.status === 'INVITED'
                        ? ('pending' as const)
                        : ('rejected' as const),
                requestedAt: r.createdAt.toISOString(),
            })),
        }
    }
}
