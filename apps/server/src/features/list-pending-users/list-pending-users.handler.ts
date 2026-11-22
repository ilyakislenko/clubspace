import { Feature, IFeatureHandler } from '@shelfjs/features'

import { pendingJoinBaseWhere } from '../../domains/requests/open-requests'
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
        // Every applicant waiting in the club (the inbox's join rule without
        // its decider scope): the app lists them to every coach and lets
        // sport leads decide.
        const pending = await this.prisma.workspaceMember.findMany({
            where: pendingJoinBaseWhere(workspaceId),
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        firstname: true,
                        lastname: true,
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
                // When they asked: the membership row is the request.
                createdAt: p.createdAt.toISOString(),
                lastSeenAt: p.user.lastSeenAt.toISOString(),
            })),
            total: pending.length,
        }
    }
}
