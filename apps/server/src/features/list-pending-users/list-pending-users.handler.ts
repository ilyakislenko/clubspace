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
        // Pending = users registered via send-auth-code who never got added
        // to ANY workspace. Trainer can promote them with a single click.
        const users = await this.prisma.user.findMany({
            where: {
                status: 'ACTIVE',
                workspaceMemberships: { none: {} },
            },
            select: {
                id: true,
                email: true,
                firstname: true,
                lastname: true,
                createdAt: true,
                lastSeenAt: true,
            },
            orderBy: { createdAt: 'desc' },
        })

        return {
            data: users.map((u) => ({
                userId: u.id,
                email: u.email,
                firstname: u.firstname,
                lastname: u.lastname,
                createdAt: u.createdAt.toISOString(),
                lastSeenAt: u.lastSeenAt.toISOString(),
            })),
            total: users.length,
        }
    }
}
