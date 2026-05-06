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
        const groupInclude = {
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
            slots: {
                orderBy: [{ dayOfWeek: 'asc' as const }, { startTime: 'asc' as const }],
            },
            exceptions: {
                where: { untilDate: { gte: new Date() } },
                orderBy: { fromDate: 'asc' as const },
            },
            _count: { select: { members: true } },
        } as const

        const [coached, joined] = await Promise.all([
            this.prisma.group.findMany({
                where: { workspaceId, coachId: userId },
                orderBy: { createdAt: 'asc' },
                include: groupInclude,
            }),
            this.prisma.groupMember.findMany({
                where: { userId, group: { workspaceId } },
                orderBy: { joinedAt: 'asc' },
                include: { group: { include: groupInclude } },
            }),
        ])

        const isoDate = (d: Date) => d.toISOString().slice(0, 10)
        const serializeGroup = (
            g: (typeof coached)[number],
            role: 'coach' | 'student',
        ) => ({
            id: g.id,
            name: g.name,
            role,
            gym: g.gym,
            coach: g.coach,
            memberCount: g._count.members,
            slots: g.slots.map((s) => ({
                id: s.id,
                dayOfWeek: s.dayOfWeek,
                startTime: s.startTime,
                durationMin: s.durationMin,
                effectiveFrom: s.effectiveFrom ? isoDate(s.effectiveFrom) : null,
                effectiveUntil: s.effectiveUntil
                    ? isoDate(s.effectiveUntil)
                    : null,
            })),
            exceptions: g.exceptions.map((e) => ({
                id: e.id,
                slotId: e.slotId,
                fromDate: isoDate(e.fromDate),
                untilDate: isoDate(e.untilDate),
                reason: e.reason,
            })),
        })

        const data = [
            ...coached.map((g) => serializeGroup(g, 'coach')),
            ...joined.map((row) => serializeGroup(row.group, 'student')),
        ]

        return { data }
    }
}
