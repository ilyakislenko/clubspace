import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ListGroupsFeature,
    ListGroupsFeatureResponse,
} from './list-groups.feature'

@Feature(ListGroupsFeature)
export class ListGroupsHandler
    implements IFeatureHandler<ListGroupsFeature, ListGroupsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute({
        workspaceId,
        invokerUserId,
        invokerRoleName,
        isSuperAdmin,
        filters,
    }: ListGroupsFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName: invokerRoleName,
            isSuperAdmin,
        })

        // Coach-own-only forces the filter to self. Coach_read_all should
        // see all groups but is NOT allowed to enumerate another coach's
        // students by passing ?coachId=<other> — that's targeted prying.
        // Only admin scope (head_coach / admin / owner / superuser) gets
        // the discretionary filter.
        const effectiveCoachId =
            ctx.scope === 'coach_own_only'
                ? invokerUserId
                : ctx.scope === 'admin'
                  ? filters.coachId
                  : undefined

        const groups = await this.prisma.group.findMany({
            where: {
                workspaceId,
                ...(effectiveCoachId ? { coachId: effectiveCoachId } : {}),
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
                members: {
                    orderBy: { joinedAt: 'asc' },
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
                    orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
                },
                exceptions: {
                    where: {
                        // Show only ongoing/future exceptions in the
                        // group view; old vacations don't need to clutter
                        // admin UX. The projection endpoint still serves
                        // them for any specific window asked for.
                        untilDate: { gte: new Date() },
                    },
                    orderBy: { fromDate: 'asc' },
                },
                _count: { select: { members: true } },
            },
        })

        const isoDate = (d: Date) => d.toISOString().slice(0, 10)

        return {
            data: groups.map((group) => ({
                id: group.id,
                name: group.name,
                gym: group.gym,
                coach: group.coach,
                coaches: group.coaches.map((c) => ({
                    userId: c.user.id,
                    email: c.user.email,
                    firstname: c.user.firstname,
                    lastname: c.user.lastname,
                    role: c.role as 'primary' | 'assistant',
                })),
                memberCount: group._count.members,
                members: group.members.map((m) => ({
                    userId: m.user.id,
                    email: m.user.email,
                    firstname: m.user.firstname,
                    lastname: m.user.lastname,
                    joinedAt: m.joinedAt.toISOString(),
                })),
                slots: group.slots.map((s) => ({
                    id: s.id,
                    dayOfWeek: s.dayOfWeek,
                    startTime: s.startTime,
                    durationMin: s.durationMin,
                    effectiveFrom: s.effectiveFrom
                        ? isoDate(s.effectiveFrom)
                        : null,
                    effectiveUntil: s.effectiveUntil
                        ? isoDate(s.effectiveUntil)
                        : null,
                })),
                exceptions: group.exceptions.map((e) => ({
                    id: e.id,
                    slotId: e.slotId,
                    fromDate: isoDate(e.fromDate),
                    untilDate: isoDate(e.untilDate),
                    reason: e.reason,
                })),
                createdAt: group.createdAt.toISOString(),
            })),
            total: groups.length,
        }
    }
}
