import { Feature, IFeatureHandler } from '@shelfjs/features'

import { notAttendedWhere } from '../../domains/metrics/attendance'
import { memberRosterWhere } from '../../domains/metrics/students'
import {
    currentSubscriptionOrderBy,
    currentSubscriptionWhere,
    subscriptionScopeSelect,
} from '../../domains/subscriptions/current-subscriptions'
import {
    owesPaymentWhere,
    renewalDueUserIds,
} from '../../domains/subscriptions/renewal-rules'
import { userSearchWhere } from '../../domains/users/user-search'
import { Prisma, PrismaService } from '../../infrastructure/prisma'
import { STAFF_ROLES } from '../../shared/decorators/roles.decorator'
import { RbacService } from '../../shared/services/rbac.service'
import {
    memberGuardiansSelect,
    serializeMemberGuardians,
} from '../dependents/schemas'
import {
    ListWorkspaceMembersFeature,
    ListWorkspaceMembersFeatureResponse,
    ListWorkspaceMembersInput,
    MEMBERS_DEFAULT_PER_PAGE,
} from './list-workspace-members.feature'

// Every word of the query must match the member (userSearchWhere).
export const memberSearchWhere = (
    q: string,
): Prisma.WorkspaceMemberWhereInput[] =>
    userSearchWhere(q).map((user) => ({ user }))

// The roster segments, one definition each (shared with the screens that
// count them): «Кончается абонемент» = the «Удержание → Продлить» list,
// «Должники» = members with an unpaid abonement (the «Ожидают оплаты» list),
// «Не были 30 дней» = students without a check-in in 30 days.
export const memberAccessWhere = async (
    prisma: PrismaService,
    access: NonNullable<ListWorkspaceMembersInput['access']>,
    ctx: { workspaceId: string; workspaceOwnerId: string; now: Date },
): Promise<Prisma.WorkspaceMemberWhereInput | null> => {
    const { workspaceId, workspaceOwnerId, now } = ctx
    switch (access) {
        case 'all':
            return null
        case 'renew':
            return {
                userId: {
                    in: await renewalDueUserIds(prisma, workspaceId, now),
                },
            }
        case 'unpaid':
            return owesPaymentWhere
        case 'inactive':
            return notAttendedWhere(workspaceId, workspaceOwnerId, now)
    }
}

const BY_NAME: Prisma.WorkspaceMemberOrderByWithRelationInput[] = [
    { user: { firstname: { sort: 'asc', nulls: 'last' } } },
    { user: { lastname: { sort: 'asc', nulls: 'last' } } },
    { user: { email: { sort: 'asc', nulls: 'last' } } },
]

// Each order ends on the row id: ties never reshuffle between page requests.
export const memberOrderBy = (
    sort: NonNullable<ListWorkspaceMembersInput['sort']>,
): Prisma.WorkspaceMemberOrderByWithRelationInput[] => {
    switch (sort) {
        case 'expiry':
            return [
                { accessUntil: { sort: 'asc', nulls: 'last' } },
                ...BY_NAME,
                { id: 'asc' },
            ]
        case 'newest':
            return [{ createdAt: 'desc' }, { id: 'asc' }]
        case 'oldest':
            return [{ createdAt: 'asc' }, { id: 'asc' }]
        case 'role':
            return [{ role: { name: 'asc' } }, ...BY_NAME, { id: 'asc' }]
        case 'name':
            return [...BY_NAME, { id: 'asc' }]
    }
}

@Feature(ListWorkspaceMembersFeature)
export class ListWorkspaceMembersHandler
    implements
        IFeatureHandler<
            ListWorkspaceMembersFeature,
            ListWorkspaceMembersFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute({
        payload,
        workspaceId,
        invokerUserId,
        invokerRoleName,
        isSuperAdmin,
    }: ListWorkspaceMembersFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName: invokerRoleName,
            isSuperAdmin,
        })

        // For coaches scoped to own groups: pre-compute the set of student
        // ids visible to them — students of the groups they coach (primary
        // or assistant) or whose direction they run, the same rule as opening
        // a member card. Coach themselves and the workspace owner stay
        // visible regardless so the list isn't disorienting (they need to see
        // their own row + know who runs the club).
        let scopedUserIds: string[] | null = null
        if (!this.rbac.canSeeAllGroups(ctx)) {
            const ids = new Set<string>([
                invokerUserId,
                ctx.workspaceOwnerId,
                ...(await this.rbac.ownGroupMemberIds(ctx)),
            ])
            scopedUserIds = [...ids]
        }

        // One clock for the whole page, so two rows can't disagree about
        // whether the same instant is "expired".
        const now = new Date()

        const curPage = payload.curPage ?? 1
        const perPage = payload.perPage ?? MEMBERS_DEFAULT_PER_PAGE

        const filters: Prisma.WorkspaceMemberWhereInput[] = [
            // INVITED rows belong to the "ожидают приглашения" panel.
            memberRosterWhere(workspaceId),
            ...(scopedUserIds ? [{ userId: { in: scopedUserIds } }] : []),
            ...(payload.q ? memberSearchWhere(payload.q) : []),
        ]
        const accessWhere = await memberAccessWhere(
            this.prisma,
            payload.access ?? 'all',
            { workspaceId, workspaceOwnerId: ctx.workspaceOwnerId, now },
        )
        if (accessWhere) filters.push(accessWhere)
        if (payload.staffOnly) {
            filters.push({
                OR: [
                    { role: { name: { in: [...STAFF_ROLES] } } },
                    { userId: ctx.workspaceOwnerId },
                ],
            })
        }

        const where: Prisma.WorkspaceMemberWhereInput = { AND: filters }

        const [members, total] = await Promise.all([
            this.prisma.workspaceMember.findMany({
                where,
                orderBy: memberOrderBy(payload.sort ?? 'name'),
                skip: (curPage - 1) * perPage,
                take: perPage,
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            firstname: true,
                            lastname: true,
                            // Shown to whoever sees this row, like the e-mail.
                            dependentOf: memberGuardiansSelect,
                        },
                    },
                    role: { select: { name: true } },
                    // Only live abonements count as "current" (an expired or
                    // cancelled pack is history, not something the member
                    // holds).
                    subscriptions: {
                        where: currentSubscriptionWhere(now),
                        orderBy: currentSubscriptionOrderBy,
                        select: {
                            classesRemaining: true,
                            classesTotal: true,
                            endDate: true,
                            plan: { select: { name: true } },
                            ...subscriptionScopeSelect,
                        },
                    },
                },
            }),
            this.prisma.workspaceMember.count({ where }),
        ])

        // Aggregated progress for this page's members only, scoped to this
        // workspace's videos.
        const userIds = members.map((m) => m.user.id)
        const [
            completedRows,
            inProgressRows,
            lastTouches,
            lastCheckInRows,
            workspaceVideoTotal,
        ] = await Promise.all([
            userIds.length > 0
                ? this.prisma.videoWatched.groupBy({
                      by: ['userId'],
                      where: {
                          workspaceId,
                          userId: { in: userIds },
                          completed: true,
                      },
                      _count: { _all: true },
                  })
                : [],
            userIds.length > 0
                ? this.prisma.videoWatched.groupBy({
                      by: ['userId'],
                      where: {
                          workspaceId,
                          userId: { in: userIds },
                          completed: false,
                          position: { gt: 0 },
                      },
                      _count: { _all: true },
                  })
                : [],
            // Latest VideoWatched row per user, with the video title — gives us
            // both the "last activity" timestamp and a concrete signal of what
            // the student is studying right now.
            userIds.length > 0
                ? this.prisma.videoWatched.findMany({
                      where: {
                          workspaceId,
                          userId: { in: userIds },
                      },
                      orderBy: [{ userId: 'asc' }, { watchedAt: 'desc' }],
                      distinct: ['userId'],
                      select: {
                          userId: true,
                          watchedAt: true,
                          video: { select: { id: true, title: true } },
                      },
                  })
                : [],
            // Most recent attendance check-in per member — the churn signal the
            // dashboard's "inactive 30d" card counts. null = never attended.
            userIds.length > 0
                ? this.prisma.attendanceRecord.groupBy({
                      by: ['userId'],
                      where: { workspaceId, userId: { in: userIds } },
                      _max: { markedAt: true },
                  })
                : [],
            this.prisma.video.count({
                where: { workspaceId, status: 'ready' },
            }),
        ])

        const completedByUser = new Map(
            completedRows.map((row) => [row.userId, row._count._all]),
        )
        const inProgressByUser = new Map(
            inProgressRows.map((row) => [row.userId, row._count._all]),
        )
        const lastByUser = new Map(
            lastTouches.map((row) => [row.userId, row]),
        )
        const lastCheckInByUser = new Map(
            lastCheckInRows.map((row) => [row.userId, row._max.markedAt]),
        )

        return {
            data: members.map((member) => {
                const last = lastByUser.get(member.user.id)
                return {
                    id: member.id,
                    userId: member.user.id,
                    email: member.user.email,
                    firstname: member.user.firstname,
                    lastname: member.user.lastname,
                    isDependent: member.user.email === null,
                    guardians: serializeMemberGuardians(member.user.dependentOf),
                    status: member.status,
                    roleName: member.role.name,
                    isOwner: member.user.id === ctx.workspaceOwnerId,
                    accessUntil: member.accessUntil
                        ? member.accessUntil.toISOString()
                        : null,
                    abonements: member.subscriptions.map((s) => ({
                        planName: s.plan.name,
                        classesRemaining: s.classesRemaining,
                        classesTotal: s.classesTotal,
                        endDate: s.endDate ? s.endDate.toISOString() : null,
                        directions: s.directions.map((d) => d.direction),
                    })),
                    createdAt: member.createdAt.toISOString(),
                    lastCheckInAt:
                        lastCheckInByUser.get(member.user.id)?.toISOString() ??
                        null,
                    watchedCount: completedByUser.get(member.user.id) ?? 0,
                    inProgressCount: inProgressByUser.get(member.user.id) ?? 0,
                    lastWatchedAt: last?.watchedAt
                        ? last.watchedAt.toISOString()
                        : null,
                    lastWatchedVideo: last?.video
                        ? {
                              id: last.video.id,
                              title: last.video.title,
                          }
                        : null,
                }
            }),
            total,
            curPage,
            perPage,
            workspaceVideoTotal,
        }
    }
}
