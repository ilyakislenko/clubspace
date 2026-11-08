import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    currentSubscriptionOrderBy,
    currentSubscriptionWhere,
    subscriptionScopeSelect,
} from '../../domains/subscriptions/current-subscriptions'
import { Prisma, PrismaService } from '../../infrastructure/prisma'
import { STAFF_ROLES } from '../../shared/decorators/roles.decorator'
import { RbacService } from '../../shared/services/rbac.service'
import {
    memberGuardiansSelect,
    serializeMemberGuardians,
} from '../dependents/schemas'
import { notAwaitingFirstVisitWhere } from '../manage-announcements/renewal-segment'
import {
    ListWorkspaceMembersFeature,
    ListWorkspaceMembersFeatureResponse,
    ListWorkspaceMembersInput,
    MEMBERS_DEFAULT_PER_PAGE,
} from './list-workspace-members.feature'

const MS_1D = 24 * 3600 * 1000
// More words than this in a search add nothing but query cost.
const MAX_SEARCH_TERMS = 5

// Every word of the query must appear in the member's name, e-mail or phone,
// or in one of a child's guardians' (the guardian is who the club knows).
export const memberSearchWhere = (
    q: string,
): Prisma.WorkspaceMemberWhereInput[] =>
    q
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, MAX_SEARCH_TERMS)
        .map((term) => {
            const contains = { contains: term, mode: 'insensitive' as const }
            const person: Prisma.UserWhereInput[] = [
                { firstname: contains },
                { lastname: contains },
                { email: contains },
                { phone: contains },
            ]
            return {
                user: {
                    OR: [
                        ...person,
                        {
                            dependentOf: {
                                some: {
                                    guardian: { status: 'ACTIVE', OR: person },
                                },
                            },
                        },
                    ],
                },
            }
        })

// The dashboard retention segments (get-workspace-stats): ACTIVE students —
// neither the owner nor staff — whose access lapsed, lapses within 14 days
// (not a pending abonement's provisional window), or who haven't checked in
// for 30 days (never included).
export const memberAccessWhere = (
    access: NonNullable<ListWorkspaceMembersInput['access']>,
    ctx: { workspaceId: string; workspaceOwnerId: string; now: Date },
): Prisma.WorkspaceMemberWhereInput | null => {
    if (access === 'all') return null
    const { workspaceId, workspaceOwnerId, now } = ctx
    const student: Prisma.WorkspaceMemberWhereInput = {
        status: 'ACTIVE',
        NOT: [
            { role: { name: { in: [...STAFF_ROLES] } } },
            { userId: workspaceOwnerId },
        ],
    }
    if (access === 'expired') {
        return { ...student, accessUntil: { lt: now } }
    }
    if (access === 'expiring') {
        return {
            ...student,
            accessUntil: {
                gte: now,
                lt: new Date(now.getTime() + 14 * MS_1D),
            },
            ...notAwaitingFirstVisitWhere,
        }
    }
    return {
        ...student,
        user: {
            attendanceRecords: {
                none: {
                    workspaceId,
                    markedAt: { gte: new Date(now.getTime() - 30 * MS_1D) },
                },
            },
        },
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
            ...(payload.q ? memberSearchWhere(payload.q) : []),
        ]
        const accessWhere = memberAccessWhere(payload.access ?? 'all', {
            workspaceId,
            workspaceOwnerId: ctx.workspaceOwnerId,
            now,
        })
        if (accessWhere) filters.push(accessWhere)
        if (payload.staffOnly) {
            filters.push({
                OR: [
                    { role: { name: { in: [...STAFF_ROLES] } } },
                    { userId: ctx.workspaceOwnerId },
                ],
            })
        }

        const where: Prisma.WorkspaceMemberWhereInput = {
            workspaceId,
            // INVITED rows belong to the "ожидают приглашения" panel.
            status: { not: 'INVITED' },
            ...(scopedUserIds ? { userId: { in: scopedUserIds } } : {}),
            ...(filters.length > 0 ? { AND: filters } : {}),
        }

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
