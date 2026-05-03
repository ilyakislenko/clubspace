import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    ListPendingUsersFeature,
    ListPendingUsersFeatureResponse,
} from './list-pending-users.feature'

@Feature(ListPendingUsersFeature)
export class ListPendingUsersHandler
    implements
        IFeatureHandler<
            ListPendingUsersFeature,
            ListPendingUsersFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ workspaceId }: ListPendingUsersFeature) {
        // Pending = workspace memberships with status=INVITED. Auto-created
        // by send-auth-code when a user signs up with workspaceKey, so the
        // list scopes to people who explicitly registered for THIS academy.
        const pending = await this.prisma.workspaceMember.findMany({
            where: { workspaceId, status: 'INVITED' },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstname: true,
                        lastname: true,
                        createdAt: true,
                        lastSeenAt: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        })

        return {
            data: pending.map((p) => ({
                userId: p.user.id,
                email: p.user.email,
                firstname: p.user.firstname,
                lastname: p.user.lastname,
                createdAt: p.user.createdAt.toISOString(),
                lastSeenAt: p.user.lastSeenAt.toISOString(),
            })),
            total: pending.length,
        }
    }
}
