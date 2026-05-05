import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    GetMyGroupsFeature,
    GetMyGroupsFeatureResponse,
} from './get-my-groups.feature'

@Feature(GetMyGroupsFeature)
export class GetMyGroupsHandler
    implements IFeatureHandler<GetMyGroupsFeature, GetMyGroupsFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ workspaceId, userId }: GetMyGroupsFeature) {
        // Two slices: groups I coach and groups I'm a student in. Combined
        // and tagged so the mobile UI can render different chip colours.
        const [coached, joined] = await Promise.all([
            this.prisma.group.findMany({
                where: { workspaceId, coachId: userId },
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
            }),
            this.prisma.groupMember.findMany({
                where: { userId, group: { workspaceId } },
                orderBy: { joinedAt: 'asc' },
                include: {
                    group: {
                        include: {
                            gym: {
                                select: {
                                    id: true,
                                    name: true,
                                    address: true,
                                },
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
                    },
                },
            }),
        ])

        const data = [
            ...coached.map((g) => ({
                id: g.id,
                name: g.name,
                role: 'coach' as const,
                scheduleText: g.scheduleText,
                gym: g.gym,
                coach: g.coach,
                memberCount: g._count.members,
            })),
            ...joined.map((row) => ({
                id: row.group.id,
                name: row.group.name,
                role: 'student' as const,
                scheduleText: row.group.scheduleText,
                gym: row.group.gym,
                coach: row.group.coach,
                memberCount: row.group._count.members,
            })),
        ]

        return { data }
    }
}
