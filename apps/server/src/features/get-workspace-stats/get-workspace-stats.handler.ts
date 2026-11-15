import { Feature, IFeatureHandler } from '@shelfjs/features'

import { countStudentsWithAbonement } from '../../domains/metrics/abonements'
import { countActiveStudents } from '../../domains/metrics/active-students'
import {
    countStudentCheckins,
    countStudentsAttended,
    countStudentsNotAttended,
} from '../../domains/metrics/attendance'
import { loadExpectedRevenue } from '../../domains/metrics/expected-revenue'
import {
    computeRevenue,
    loadCurrentSales,
    loadRefunds,
    loadSales,
    netRevenue,
    paidOn,
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

        // Club money is for the owner and admins only: a head coach or a coach
        // never receives it — not just hidden in UI.
        const clubAdmin = isClubAdmin(ctx, {
            roleName: invokerRoleName,
            isSuperAdmin,
        })
        // «Продлить» is the sport leads' list; a coach gets no count.
        const sportLead = this.rbac.canWriteAllGroups(ctx)

        // For coach_own_only: pre-compute the visible userId set (students of
        // their own groups — coached or of a direction they run, ownGroupsWhere
        // — plus the coach themselves). Student counts narrow to it; the video
        // library counts stay workspace-wide because the library is shared by
        // design.
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

        const [videos, videosReady] = await this.prisma.$transaction([
            this.prisma.video.count({ where: { workspaceId } }),
            this.prisma.video.count({
                where: { workspaceId, status: 'ready' },
            }),
        ])

        // ---- Students, attendance, retention (glossary metrics) ----
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
        ])

        // ---- Today (workspace-local calendar day) ----
        const todayDate = localDateInTz(now, tz)
        const dayStart = wallClockToUtc(`${todayDate}T00:00:00`, tz)

        // ---- Revenue (club admins only; a head coach or coach never sees it) ----
        let revenue: GetWorkspaceStatsFeatureResponse['revenue'] = null
        let todayRevenue: { amount: number; currency: string | null } | null = null
        if (clubAdmin) {
            const windowStart = revenueWindowStart(now)
            const prevStart = new Date(windowStart.getTime() - 30 * DAY_MS)
            const [current, sales, refunds, awaitingRows, owing, horizons] = await Promise.all([
                loadCurrentSales(this.prisma, workspaceId, now),
                // 60 days of paid sales and of their refunds: revenue30d, the
                // 30 days before it (the trend) and today's revenue, all net.
                loadSales(this.prisma, workspaceId, prevStart),
                loadRefunds(this.prisma, workspaceId, prevStart),
                // The receivable (same rows as the «Ожидают оплаты» list).
                this.prisma.subscription.findMany({
                    where: awaitingPaymentWhere(workspaceId),
                    select: { amountPaid: true, currency: true },
                }),
                countAwaitingPaymentMembers(this.prisma, workspaceId),
                loadExpectedRevenue(this.prisma, workspaceId),
            ])
            const summary = computeRevenue(
                current,
                sales.filter((r) => paidOn(r) >= windowStart),
                refunds.filter((r) => r.refundedAt >= windowStart),
            )
            revenue = {
                revenue30d: summary.revenue30d,
                mrr: summary.mrr,
                currency: summary.currency,
                expected30d: horizons[0].expected,
                awaitingPayment: {
                    students: owing,
                    amount: summarizeAwaiting(awaitingRows, summary.currency).amount,
                },
                revenuePrev30d: netRevenue(sales, refunds, summary.currency, {
                    gte: prevStart,
                    lt: windowStart,
                }),
            }
            todayRevenue = sumRevenue(
                sales.filter((r) => paidOn(r) >= dayStart),
                refunds.filter((r) => r.refundedAt >= dayStart),
            )
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

        return {
            today,
            counts: {
                videos,
                videosReady,
                students: studentsTotal,
                activeStudents,
                studentsWithAbonement,
            },
            attendance: {
                sessions7d,
                sessions30d,
                checkins7d,
                checkins30d,
                attendedStudents7d,
                attendedStudents30d,
            },
            retention: { notAttended30d, renewalsDue },
            revenue,
        }
    }
}
