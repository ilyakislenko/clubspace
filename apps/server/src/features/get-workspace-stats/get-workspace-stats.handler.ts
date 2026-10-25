import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    MemberStatus,
    PrismaService,
    SubscriptionStatus,
} from '../../infrastructure/prisma'
import { STAFF_ROLES } from '../../shared/decorators/roles.decorator'
import { RbacService } from '../../shared/services/rbac.service'
import {
    GetWorkspaceStatsFeature,
    GetWorkspaceStatsFeatureResponse,
} from './get-workspace-stats.feature'
import {
    localDateInTz,
    wallClockToUtc,
} from '../attendance/attendance-utils'
import { notAwaitingFirstVisitWhere } from '../manage-announcements/renewal-segment'
import { GetWorkspaceScheduleFeature } from '../get-workspace-schedule/get-workspace-schedule.feature'
import { GetWorkspaceScheduleHandler } from '../get-workspace-schedule/get-workspace-schedule.handler'
import { attendanceTrend } from './attendance-trend'
import {
    awaitingPaymentWhere,
    computeRevenue,
    paidInRangeWhere,
    paidOn,
    revenueByPlan,
    revenueTrend,
    summarizeAwaiting,
    sumRevenue,
} from './revenue'

@Feature(GetWorkspaceStatsFeature)
export class GetWorkspaceStatsHandler
    implements
        IFeatureHandler<
            GetWorkspaceStatsFeature,
            GetWorkspaceStatsFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly schedule: GetWorkspaceScheduleHandler,
    ) {}

    async execute({
        workspaceId,
        invokerUserId,
        invokerRoleName,
        isSuperAdmin,
    }: GetWorkspaceStatsFeature) {
        const now = new Date()
        const since7 = new Date(now.getTime() - 7 * 24 * 3600 * 1000)
        const since30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000)
        const in14 = new Date(now.getTime() + 14 * 24 * 3600 * 1000)
        // First day of the month 5 months ago (UTC) — the 6-month trend window.
        const since6mo = new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1),
        )

        const ctx = await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName: invokerRoleName,
            isSuperAdmin,
        })

        // Club money is admin-scope only: coaches (own-only or read-all) never
        // see revenue.
        const canSeeRevenue = this.rbac.canWriteAllGroups(ctx)

        // For coach_own_only: pre-compute the visible userId set (own
        // students + coach themselves). Activity stats and top videos
        // get filtered by this set; member count narrows to it; content
        // counts (videos, courses) stay workspace-wide because the
        // content library is shared by design.
        let scopedUserIds: string[] | null = null
        let scopedGroupIds: string[] | null = null
        if (ctx.scope === 'coach_own_only') {
            const ownGroups = await this.prisma.group.findMany({
                where: { workspaceId, coachId: invokerUserId },
                select: { id: true, members: { select: { userId: true } } },
            })
            const ids = new Set<string>([
                invokerUserId,
                ...ownGroups.flatMap((g) => g.members.map((m) => m.userId)),
            ])
            scopedUserIds = [...ids]
            scopedGroupIds = ownGroups.map((g) => g.id)
        }

        const userScope =
            scopedUserIds !== null
                ? { userId: { in: scopedUserIds } }
                : {}
        const memberWhere =
            scopedUserIds !== null
                ? { workspaceId, userId: { in: scopedUserIds } }
                : { workspaceId }
        // Sessions carry a groupId; a scoped coach sees only their groups'
        // sessions (event/ad-hoc sessions with no group fall away for them).
        const sessionWhere =
            scopedGroupIds !== null
                ? { workspaceId, groupId: { in: scopedGroupIds } }
                : { workspaceId }

        // The club's own people are not "students": the owner and anyone with a
        // coaching/admin role stay out of every student counter (members,
        // active, inactive, access) so a coach never reads as a churned member.
        const clubOwner = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { ownerId: true, timezone: true },
        })
        const studentWhere = {
            ...memberWhere,
            NOT: [
                { role: { name: { in: [...STAFF_ROLES] } } },
                ...(clubOwner?.ownerId ? [{ userId: clubOwner.ownerId }] : []),
            ],
        }

        const [videos, videosReady, courses, members, recentEventsRaw] =
            await this.prisma.$transaction([
                this.prisma.video.count({ where: { workspaceId } }),
                this.prisma.video.count({
                    where: { workspaceId, status: 'ready' },
                }),
                this.prisma.course.count({ where: { workspaceId } }),
                this.prisma.workspaceMember.count({ where: studentWhere }),
                this.prisma.auditEvent.findMany({
                    where: { workspaceId },
                    orderBy: { createdAt: 'desc' },
                    take: 10,
                }),
            ])

        const [viewers7Rows, viewers30Rows, completions7Total, topVideoRows] =
            await Promise.all([
                this.prisma.videoWatched.findMany({
                    where: {
                        workspaceId,
                        watchedAt: { gte: since7 },
                        ...userScope,
                    },
                    distinct: ['userId'],
                    select: { userId: true },
                }),
                this.prisma.videoWatched.findMany({
                    where: {
                        workspaceId,
                        watchedAt: { gte: since30 },
                        ...userScope,
                    },
                    distinct: ['userId'],
                    select: { userId: true },
                }),
                this.prisma.videoWatched.count({
                    where: {
                        workspaceId,
                        completed: true,
                        watchedAt: { gte: since7 },
                        ...userScope,
                    },
                }),
                // Top videos by distinct viewers in the last 7 days. We pull a
                // bit more than 5 to allow tie-breaking by completion count.
                this.prisma.videoWatched.groupBy({
                    by: ['videoId'],
                    where: {
                        workspaceId,
                        watchedAt: { gte: since7 },
                        ...userScope,
                    },
                    _count: { userId: true },
                    orderBy: { _count: { userId: 'desc' } },
                    take: 8,
                }),
            ])

        const topVideoIds = topVideoRows.map((row) => row.videoId)
        const [topVideoMeta, completionsByVideo] = await Promise.all([
            topVideoIds.length > 0
                ? this.prisma.video.findMany({
                      where: { id: { in: topVideoIds } },
                      select: { id: true, title: true },
                  })
                : [],
            topVideoIds.length > 0
                ? this.prisma.videoWatched.groupBy({
                      by: ['videoId'],
                      where: {
                          workspaceId,
                          videoId: { in: topVideoIds },
                          completed: true,
                          watchedAt: { gte: since7 },
                          ...userScope,
                      },
                      _count: { _all: true },
                  })
                : [],
        ])

        const titleByVideo = new Map(
            topVideoMeta.map((v) => [v.id, v.title]),
        )
        const completionsByVideoMap = new Map(
            completionsByVideo.map((row) => [row.videoId, row._count._all]),
        )

        const topVideos7d = topVideoRows
            .map((row) => ({
                id: row.videoId,
                title: titleByVideo.get(row.videoId) ?? 'Удалённое видео',
                viewers: row._count.userId,
                completions: completionsByVideoMap.get(row.videoId) ?? 0,
            }))
            .slice(0, 5)

        // ---- Attendance + retention (gym health) ----
        const [
            sessions7d,
            sessions30d,
            checkins7d,
            checkins30d,
            attendees7dRows,
            attendees30dRows,
            activeMemberRows,
            expiredAccess,
            expiringSoon,
            studentRows,
        ] = await Promise.all([
            this.prisma.attendanceSession.count({
                where: { ...sessionWhere, startAt: { gte: since7, lte: now } },
            }),
            this.prisma.attendanceSession.count({
                where: { ...sessionWhere, startAt: { gte: since30, lte: now } },
            }),
            this.prisma.attendanceRecord.count({
                where: { workspaceId, markedAt: { gte: since7 }, ...userScope },
            }),
            this.prisma.attendanceRecord.count({
                where: { workspaceId, markedAt: { gte: since30 }, ...userScope },
            }),
            this.prisma.attendanceRecord.findMany({
                where: { workspaceId, markedAt: { gte: since7 }, ...userScope },
                distinct: ['userId'],
                select: { userId: true },
            }),
            this.prisma.attendanceRecord.findMany({
                where: { workspaceId, markedAt: { gte: since30 }, ...userScope },
                distinct: ['userId'],
                select: { userId: true },
            }),
            this.prisma.workspaceMember.findMany({
                where: { ...studentWhere, status: MemberStatus.ACTIVE },
                select: { userId: true },
            }),
            this.prisma.workspaceMember.count({
                where: {
                    ...studentWhere,
                    status: MemberStatus.ACTIVE,
                    accessUntil: { lt: now },
                },
            }),
            this.prisma.workspaceMember.count({
                where: {
                    ...studentWhere,
                    status: MemberStatus.ACTIVE,
                    accessUntil: { gte: now, lt: in14 },
                    // A pending abonement's window is provisional, not expiring.
                    ...notAwaitingFirstVisitWhere,
                },
            }),
            // Every student whatever the status — the attendance cards count
            // students only, like the member counters above.
            this.prisma.workspaceMember.findMany({
                where: studentWhere,
                select: { userId: true },
            }),
        ])
        const allStudentIds = new Set(studentRows.map((m) => m.userId))

        // Weekly check-in trend (last 8 weeks), same scope as the counts above.
        const since8w = new Date(now.getTime() - 8 * 7 * 24 * 3600 * 1000)
        const trendRows = await this.prisma.attendanceRecord.findMany({
            where: { workspaceId, markedAt: { gte: since8w }, ...userScope },
            select: { markedAt: true },
        })
        const attendanceTrendPoints = attendanceTrend(
            trendRows.map((r) => r.markedAt),
            now,
            8,
        )

        const attendedSet = new Set(attendees30dRows.map((r) => r.userId))
        const inactiveMembers30d = activeMemberRows.filter(
            (m) => !attendedSet.has(m.userId),
        ).length
        // Active = a student with at least one check-in in the window (not a
        // video view — those are reported separately as viewers).
        const studentIds = new Set(activeMemberRows.map((m) => m.userId))
        const activeMembers7d = attendees7dRows.filter((r) =>
            studentIds.has(r.userId),
        ).length
        const activeMembers30d = attendees30dRows.filter((r) =>
            studentIds.has(r.userId),
        ).length

        // ---- Revenue (admin scope only; a coach never sees club money) ----
        let revenue: GetWorkspaceStatsFeatureResponse['revenue'] = null
        if (canSeeRevenue) {
            const [activeSubRows, recent6moRows, awaitingRows] = await Promise.all([
                this.prisma.subscription.findMany({
                    where: {
                        workspaceId,
                        status: SubscriptionStatus.ACTIVE,
                        OR: [{ endDate: null }, { endDate: { gt: now } }],
                    },
                    select: {
                        amountPaid: true,
                        currency: true,
                        isPaid: true,
                        startDate: true,
                        endDate: true,
                    },
                }),
                // Six months of PAID sales (dated by the payment) powers both the
                // trend chart and — via the trailing-30-day slice below —
                // revenue30d + the tariff breakdown.
                this.prisma.subscription.findMany({
                    where: { workspaceId, ...paidInRangeWhere({ gte: since6mo }) },
                    select: {
                        amountPaid: true,
                        currency: true,
                        paidAt: true,
                        createdAt: true,
                        planId: true,
                        plan: { select: { name: true } },
                    },
                }),
                // The receivable (same rows as the «Ожидают оплаты» list).
                this.prisma.subscription.findMany({
                    where: awaitingPaymentWhere(workspaceId),
                    select: { amountPaid: true, currency: true },
                }),
            ])
            const recent6mo = recent6moRows.map((r) => ({
                amountPaid: r.amountPaid,
                currency: r.currency,
                paidAt: r.paidAt,
                createdAt: r.createdAt,
                planId: r.planId,
                planName: r.plan.name,
            }))
            const recent30 = recent6mo.filter((r) => paidOn(r) >= since30)
            const summary = computeRevenue(activeSubRows, recent30)
            revenue = {
                ...summary,
                awaitingPayment: summarizeAwaiting(awaitingRows, summary.currency),
                trend: revenueTrend(recent6mo, now, summary.currency),
                byPlan: revenueByPlan(recent30, summary.currency),
            }
        }

        // ---- Today (workspace-local calendar day) ----
        const tz = clubOwner?.timezone ?? 'Europe/Moscow'
        const dayStart = wallClockToUtc(
            `${localDateInTz(now, tz)}T00:00:00`,
            tz,
        )

        // Classes on today's timetable (not only the ones a coach already
        // opened), through the same projection the schedule screens use, so a
        // cancelled class doesn't count and a morning shows the day ahead.
        const todayDate = localDateInTz(now, tz)
        const todaySchedule = await this.schedule.execute(
            new GetWorkspaceScheduleFeature(
                { from: todayDate, to: todayDate },
                workspaceId,
            ),
        )
        const scheduledToday = todaySchedule.sessions.filter(
            (s) =>
                !s.cancelled &&
                (scopedGroupIds === null || scopedGroupIds.includes(s.groupId)),
        ).length

        const [
            personalToday,
            checkinsToday,
            newMembersToday,
            todayRevRows,
        ] =
            await Promise.all([
                // Personal sessions are not on the timetable: they count only
                // once held (started), like the sessions7d/30d counters above.
                this.prisma.attendanceSession.count({
                    where: {
                        ...sessionWhere,
                        isPersonal: true,
                        startAt: { gte: dayStart, lte: now },
                    },
                }),
                this.prisma.attendanceRecord.count({
                    where: {
                        workspaceId,
                        markedAt: { gte: dayStart },
                        userId: { in: [...allStudentIds] },
                    },
                }),
                this.prisma.workspaceMember.count({
                    where: { ...studentWhere, createdAt: { gte: dayStart } },
                }),
                // Revenue is admin-only, mirroring the revenue card.
                canSeeRevenue
                    ? this.prisma.subscription.findMany({
                          where: { workspaceId, ...paidInRangeWhere({ gte: dayStart }) },
                          select: { amountPaid: true, currency: true },
                      })
                    : [],
            ])
        const todayRevenue = canSeeRevenue ? sumRevenue(todayRevRows) : null
        const today = {
            sessions: scheduledToday + personalToday,
            checkins: checkinsToday,
            newMembers: newMembersToday,
            revenue: todayRevenue?.amount ?? null,
            currency: todayRevenue?.currency ?? null,
        }

        const actorIds = Array.from(
            new Set(
                recentEventsRaw
                    .map((event) => event.actorId)
                    .filter((id): id is string => Boolean(id)),
            ),
        )

        const actors = actorIds.length
            ? await this.prisma.user.findMany({
                  where: { id: { in: actorIds } },
                  select: { id: true, email: true },
              })
            : []

        const actorEmail = new Map(actors.map((u) => [u.id, u.email]))

        return {
            today,
            counts: { videos, videosReady, courses, members },
            activity: {
                activeMembers7d,
                activeMembers30d,
                videoViewers7d: viewers7Rows.length,
                videoViewers30d: viewers30Rows.length,
                completions7d: completions7Total,
            },
            attendance: {
                sessions7d,
                sessions30d,
                checkins7d,
                checkins30d,
                distinctAttendees30d: attendees30dRows.filter((r) =>
                    allStudentIds.has(r.userId),
                ).length,
                trend: attendanceTrendPoints,
            },
            retention: {
                inactiveMembers30d,
                expiredAccess,
                expiringSoon,
            },
            revenue,
            topVideos7d,
            recentEvents: recentEventsRaw.map((event) => ({
                id: event.id,
                action: event.action,
                targetType: event.targetType,
                targetId: event.targetId,
                actorEmail: event.actorId
                    ? actorEmail.get(event.actorId) ?? null
                    : null,
                createdAt: event.createdAt.toISOString(),
            })),
        }
    }
}
