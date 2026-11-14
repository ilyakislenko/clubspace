import { Feature, IFeatureHandler } from '@shelfjs/features'

import { countStudentsWithAbonement } from '../../domains/metrics/abonements'
import { countActiveStudents } from '../../domains/metrics/active-students'
import {
    countStudentCheckins,
    countStudentsAttended,
    countStudentsNotAttended,
    studentCheckinsWhere,
} from '../../domains/metrics/attendance'
import { loadExpectedRevenue } from '../../domains/metrics/expected-revenue'
import {
    computeRevenue,
    loadCurrentSales,
    loadSales,
    paidOn,
    revenueByPlan,
    revenueTrend,
    revenueTrendStart,
    revenueWindowStart,
    summarizeAwaiting,
    sumRevenue,
} from '../../domains/metrics/revenue'
import {
    countNewStudents,
    countStudents,
    type StudentScope,
} from '../../domains/metrics/students'
import {
    awaitingPaymentWhere,
    countAwaitingPaymentMembers,
    countRenewalsDue,
} from '../../domains/subscriptions/renewal-rules'
import { PrismaService } from '../../infrastructure/prisma'
import { isClubAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    GetWorkspaceStatsFeature,
    GetWorkspaceStatsFeatureResponse,
} from './get-workspace-stats.feature'
import {
    localDateInTz,
    wallClockToUtc,
} from '../attendance/attendance-utils'
import { GetWorkspaceScheduleFeature } from '../get-workspace-schedule/get-workspace-schedule.feature'
import { GetWorkspaceScheduleHandler } from '../get-workspace-schedule/get-workspace-schedule.handler'
import { attendanceTrend } from './attendance-trend'

const DAY_MS = 24 * 3600 * 1000

// The dashboard: every number is a glossary metric from domains/metrics
// (docs/design/2026-11-08-admin-cleanup.md B2), so it equals the same metric
// on the forecast, the bill and the members list.
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
        const since7 = new Date(now.getTime() - 7 * DAY_MS)
        const since30 = new Date(now.getTime() - 30 * DAY_MS)

        const ctx = await this.rbac.resolveCoachScope({
            userId: invokerUserId,
            workspaceId,
            roleName: invokerRoleName,
            isSuperAdmin,
        })

        // Club money and the audit feed are for the owner and admins only: a
        // head coach or a coach never receives them — not just hidden in UI.
        const clubAdmin = isClubAdmin(ctx, {
            roleName: invokerRoleName,
            isSuperAdmin,
        })
        // «Продлить» is the sport leads' list; a coach gets no count.
        const sportLead = this.rbac.canWriteAllGroups(ctx)

        // For coach_own_only: pre-compute the visible userId set (students of
        // their own groups — coached or of a direction they run, ownGroupsWhere
        // — plus the coach themselves). Activity stats and top videos
        // get filtered by this set; student counts narrow to it; content
        // counts (videos, courses) stay workspace-wide because the
        // content library is shared by design.
        let scopedUserIds: string[] | null = null
        let scopedGroupIds: string[] | null = null
        if (!this.rbac.canSeeAllGroups(ctx)) {
            const [groupIds, memberIds] = await Promise.all([
                this.rbac.ownGroupIds(ctx),
                this.rbac.ownGroupMemberIds(ctx),
            ])
            scopedUserIds = [...new Set([invokerUserId, ...memberIds])]
            scopedGroupIds = groupIds
        }

        const userScope =
            scopedUserIds !== null
                ? { userId: { in: scopedUserIds } }
                : {}
        // Sessions carry a groupId; a scoped coach sees only their groups'
        // sessions (event/ad-hoc sessions with no group fall away for them).
        const sessionWhere =
            scopedGroupIds !== null
                ? { workspaceId, groupId: { in: scopedGroupIds } }
                : { workspaceId }

        const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { timezone: true },
        })
        const tz = workspace?.timezone ?? 'Europe/Moscow'
        const students: StudentScope = {
            workspaceId,
            ownerId: ctx.workspaceOwnerId,
            ...(scopedUserIds !== null ? { where: userScope } : {}),
        }

        const [videos, videosReady, courses, recentEventsRaw] =
            await this.prisma.$transaction([
                this.prisma.video.count({ where: { workspaceId } }),
                this.prisma.video.count({
                    where: { workspaceId, status: 'ready' },
                }),
                this.prisma.course.count({ where: { workspaceId } }),
                // «История изменений» rows: club admins only (empty otherwise).
                this.prisma.auditEvent.findMany({
                    where: { workspaceId },
                    orderBy: { createdAt: 'desc' },
                    take: clubAdmin ? 10 : 0,
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

        // ---- Students, attendance, retention (glossary metrics) ----
        const since8w = new Date(now.getTime() - 8 * 7 * DAY_MS)
        const [
            studentsTotal,
            activeStudents,
            studentsWithAbonement,
            sessions7d,
            sessions30d,
            checkins7d,
            checkins30d,
            attendedStudents7d,
            attendedStudents30d,
            notAttended30d,
            renewalsDue,
            trendRows,
        ] = await Promise.all([
            countStudents(this.prisma, students),
            countActiveStudents(this.prisma, students, now),
            countStudentsWithAbonement(this.prisma, students, now),
            this.prisma.attendanceSession.count({
                where: { ...sessionWhere, startAt: { gte: since7, lte: now } },
            }),
            this.prisma.attendanceSession.count({
                where: { ...sessionWhere, startAt: { gte: since30, lte: now } },
            }),
            countStudentCheckins(this.prisma, students, since7),
            countStudentCheckins(this.prisma, students, since30),
            countStudentsAttended(this.prisma, students, since7),
            countStudentsAttended(this.prisma, students, since30),
            countStudentsNotAttended(this.prisma, students, now),
            sportLead ? countRenewalsDue(this.prisma, workspaceId, now) : null,
            // Weekly check-in trend (last 8 weeks), same students as above.
            this.prisma.attendanceRecord.findMany({
                where: studentCheckinsWhere(students, since8w),
                select: { markedAt: true },
            }),
        ])
        const attendanceTrendPoints = attendanceTrend(
            trendRows.map((r) => r.markedAt),
            now,
            8,
        )

        // ---- Today (workspace-local calendar day) ----
        const todayDate = localDateInTz(now, tz)
        const dayStart = wallClockToUtc(`${todayDate}T00:00:00`, tz)

        // ---- Revenue (club admins only; a head coach or coach never sees it) ----
        let revenue: GetWorkspaceStatsFeatureResponse['revenue'] = null
        let todayRevenue: { amount: number; currency: string | null } | null = null
        if (clubAdmin) {
            const trendStart = revenueTrendStart(now, tz)
            const [current, sales, awaitingRows, owing, horizons] = await Promise.all([
                loadCurrentSales(this.prisma, workspaceId, now),
                // Six months of paid sales power the trend chart, today's
                // revenue and — via the trailing-30-day slice — revenue30d
                // and the tariff breakdown.
                loadSales(this.prisma, workspaceId, trendStart),
                // The receivable (same rows as the «Ожидают оплаты» list).
                this.prisma.subscription.findMany({
                    where: awaitingPaymentWhere(workspaceId),
                    select: { amountPaid: true, currency: true },
                }),
                countAwaitingPaymentMembers(this.prisma, workspaceId),
                loadExpectedRevenue(this.prisma, workspaceId),
            ])
            const windowStart = revenueWindowStart(now)
            const recent30 = sales.filter((r) => paidOn(r) >= windowStart)
            const summary = computeRevenue(current, recent30)
            revenue = {
                ...summary,
                expected30d: horizons[0].expected,
                awaitingPayment: {
                    students: owing,
                    amount: summarizeAwaiting(awaitingRows, summary.currency).amount,
                },
                trend: revenueTrend(sales, now, summary.currency, tz),
                byPlan: revenueByPlan(recent30, summary.currency),
            }
            todayRevenue = sumRevenue(sales.filter((r) => paidOn(r) >= dayStart))
        }

        // Classes on today's timetable (not only the ones a coach already
        // opened), through the same projection the schedule screens use, so a
        // cancelled class doesn't count and a morning shows the day ahead.
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

        const [personalToday, checkinsToday, newStudentsToday] =
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
                countStudentCheckins(this.prisma, students, dayStart),
                countNewStudents(this.prisma, students, dayStart),
            ])
        const today = {
            sessions: scheduledToday + personalToday,
            checkins: checkinsToday,
            newStudents: newStudentsToday,
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
            counts: {
                videos,
                videosReady,
                courses,
                students: studentsTotal,
                activeStudents,
                studentsWithAbonement,
            },
            activity: {
                videoViewers7d: viewers7Rows.length,
                videoViewers30d: viewers30Rows.length,
                completions7d: completions7Total,
            },
            attendance: {
                sessions7d,
                sessions30d,
                checkins7d,
                checkins30d,
                attendedStudents7d,
                attendedStudents30d,
                trend: attendanceTrendPoints,
            },
            retention: { notAttended30d, renewalsDue },
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
