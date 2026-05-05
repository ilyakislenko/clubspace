import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    ListGroupsFeature,
    ListGroupsFeatureResponse,
} from './list-groups.feature'

@Feature(ListGroupsFeature)
export class ListGroupsHandler
    implements IFeatureHandler<ListGroupsFeature, ListGroupsFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ workspaceId, filters }: ListGroupsFeature) {
        const groups = await this.prisma.group.findMany({
            where: {
                workspaceId,
                ...(filters.coachId ? { coachId: filters.coachId } : {}),
            },
            orderBy: { createdAt: 'asc' },
            include: {
                gym: {
                    select: { id: true, name: true, address: true },
                },
                coach: {
                    select: {
                        id: true,
                        email: true,
                        firstname: true,
                        lastname: true,
                    },
                },
                _count: { select: { members: true } },
            },
        })

        return {
            data: groups.map((group) => ({
                id: group.id,
                name: group.name,
                scheduleText: group.scheduleText,
                gym: group.gym,
                coach: group.coach,
                memberCount: group._count.members,
                createdAt: group.createdAt.toISOString(),
            })),
            total: groups.length,
        }
    }
}
