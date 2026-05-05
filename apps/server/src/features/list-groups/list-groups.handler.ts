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
                members: group.members.map((m) => ({
                    userId: m.user.id,
                    email: m.user.email,
                    firstname: m.user.firstname,
                    lastname: m.user.lastname,
                    joinedAt: m.joinedAt.toISOString(),
                })),
                createdAt: group.createdAt.toISOString(),
            })),
            total: groups.length,
        }
    }
}
