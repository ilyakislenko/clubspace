import { Feature, IFeatureHandler } from '@shelfjs/features'

import { loadBirthdayMembers, turnsOn } from '../../domains/birthdays/birthdays'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import {
    ownGroupsWhere,
    RbacService,
} from '../../shared/services/rbac.service'
import { localDateInTz } from '../attendance/attendance-utils'
import { displayName } from '../attendance/schemas'
import {
    ListBirthdaysTodayFeature,
    ListBirthdaysTodayFeatureResponse,
} from './list-birthdays-today.feature'

// Members whose birthday is today, club-local. Sport leads see the club; a
// coach sees the students of their own groups (the ones they congratulate in
// class), even where coaches may read every group.
@Feature(ListBirthdaysTodayFeature)
export class ListBirthdaysTodayHandler
    implements
        IFeatureHandler<
            ListBirthdaysTodayFeature,
            ListBirthdaysTodayFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListBirthdaysTodayFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { timezone: true },
        })
        if (!workspace) throw new NotFoundError({ message: 'Клуб не найден' })
        const date = localDateInTz(new Date(), workspace.timezone)

        const ownOnly = !this.rbac.canWriteAllGroups(ctx)
        const scopedIds = ownOnly ? await this.rbac.ownGroupMemberIds(ctx) : undefined
        if (scopedIds?.length === 0) return { date, members: [] }

        const people = await loadBirthdayMembers(this.prisma, {
            workspaceId: f.workspaceId,
            ymd: date,
            userIds: scopedIds,
        })
        if (people.length === 0) return { date, members: [] }

        const memberships = await this.prisma.groupMember.findMany({
            where: {
                userId: { in: people.map((p) => p.userId) },
                group: {
                    workspaceId: f.workspaceId,
                    ...(ownOnly ? ownGroupsWhere(ctx.userId) : {}),
                },
            },
            select: { userId: true, group: { select: { id: true, name: true } } },
            orderBy: { group: { name: 'asc' } },
        })
        const groupsOf = new Map<string, { id: string; name: string }[]>()
        for (const m of memberships) {
            groupsOf.set(m.userId, [...(groupsOf.get(m.userId) ?? []), m.group])
        }

        const members = people
            .map((p) => {
                const isDependent = p.email === null
                return {
                    userId: p.userId,
                    name: displayName(p),
                    photoUrl: p.profilePhotoUrl,
                    isDependent,
                    turns: isDependent ? turnsOn(p.dateOfBirth, date) : null,
                    groups: groupsOf.get(p.userId) ?? [],
                }
            })
            .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
        return { date, members }
    }
}
