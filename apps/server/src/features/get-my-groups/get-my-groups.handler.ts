import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { COACHING_ROLES } from '../../shared/decorators/roles.decorator'
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
        // Three slices: groups I primary-coach, groups I assist, groups
        // I'm a student in. Tagged for the mobile UI to colour chips.
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
            coaches: {
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            firstname: true,
                            lastname: true,
                        },
                    },
                },
            },
            slots: {
                orderBy: [
                    { dayOfWeek: 'asc' },
                    { startTime: 'asc' },
                ] satisfies Array<Record<string, 'asc' | 'desc'>>,
            },
            exceptions: {
                where: { untilDate: { gte: new Date() } },
                orderBy: { fromDate: 'asc' } satisfies Record<
                    string,
                    'asc' | 'desc'
                >,
            },
            _count: { select: { members: true } },
        }

        // Coached query goes through GroupCoach junction so we catch
        // assistant assignments too — not just rows where coachId
        // matches. The legacy denormalised primary still appears,
        // because it's mirrored into the junction at create-group time.
        // GroupCoach rows outlive a demotion, so the member's current role
        // (or ownership) decides whether they still count as a coach.
        const [coachAssignments, joined, member, workspace] = await Promise.all([
            this.prisma.groupCoach.findMany({
                where: { userId, group: { workspaceId } },
                orderBy: { group: { createdAt: 'asc' } },
                include: { group: { include: groupInclude } },
            }),
            this.prisma.groupMember.findMany({
                where: { userId, group: { workspaceId } },
                orderBy: { joinedAt: 'asc' },
                include: { group: { include: groupInclude } },
            }),
            this.prisma.workspaceMember.findFirst({
                where: { userId, workspaceId },
                select: { role: { select: { name: true } } },
            }),
            this.prisma.workspace.findUnique({
                where: { id: workspaceId },
                select: { ownerId: true },
            }),
        ])
        const canCoach =
            workspace?.ownerId === userId ||
            (member !== null &&
                (COACHING_ROLES as string[]).includes(member.role.name))

        const isoDate = (d: Date) => d.toISOString().slice(0, 10)
        const serializeGroup = (
            g: (typeof coachAssignments)[number]['group'],
            role: 'coach' | 'student',
        ) => ({
            id: g.id,
            name: g.name,
            role,
            gym: g.gym,
            coach: g.coach,
            coaches: g.coaches.map((c) => ({
                userId: c.user.id,
                email: c.user.email,
                firstname: c.user.firstname,
                lastname: c.user.lastname,
                role: c.role as 'primary' | 'assistant',
            })),
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

        // De-dupe by group id: the same group could in theory show up in
        // both coachAssignments and joined (impossible in normal create
        // flows, but if a stray junction row sneaks in, the coach view
        // wins and we don't render duplicates).
        const seen = new Set<string>()
        const data: ReturnType<typeof serializeGroup>[] = []
        for (const row of canCoach ? coachAssignments : []) {
            if (seen.has(row.group.id)) continue
            seen.add(row.group.id)
            data.push(serializeGroup(row.group, 'coach'))
        }
        for (const row of joined) {
            if (seen.has(row.group.id)) continue
            seen.add(row.group.id)
            data.push(serializeGroup(row.group, 'student'))
        }

        return { data }
    }
}
