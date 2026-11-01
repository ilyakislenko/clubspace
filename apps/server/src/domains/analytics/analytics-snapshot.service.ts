import { Injectable, Logger } from '@nestjs/common'

import {
    localDateInTz,
    resolveGroupSessionTz,
    scheduledOccurrenceKey,
    wallClockToUtc,
} from '../../features/attendance/attendance-utils'
import { type Prisma, PrismaService } from '../../infrastructure/prisma'
import { COACHING_ROLES } from '../../shared/decorators/roles.decorator'
import { isFrozenNow } from '../retention/risk-signals'
import { localHourInTz } from '../scheduler/clubs-due'
import { scopeDirectionIds, subscriptionScopeIdsSelect } from '../subscriptions/current-subscriptions'
import { addDaysYmd, DAY_MS, dbDateToYmd, ymdToDbDate } from '../subscriptions/freeze-dates'
import { isSubscriptionUsable } from '../subscriptions/subscription-status'
import { CHURN_RULES, computeChurnScore, monthlySpend } from './churn-score'
import {
    clubRenewalRate,
    type ForecastSubscription,
    memberForecast,
    memberRenewalProbability,
    renewalHistory,
    trialFacts,
} from './forecast'

// How far back the slot occurrences go (the occupancy window's maximum).
export const OCCURRENCE_HISTORY_DAYS = 26 * 7
// Abonements older than this never matter to the score, spend or forecast.
const SUBSCRIPTION_HISTORY_DAYS = 400
// Club-local hour of the nightly history rebuild.
export const ANALYTICS_NIGHTLY_HOUR = 4
const FREEZE_LOOKAHEAD_DAYS = 7

// Builds the «Аналитика» snapshots of one club (docs/design/
// 2026-11-01-smart-analytics.md). Two parts:
//  - history (nightly): visit spans per member × group, past slot occurrences;
//  - risk (hourly): churn score, spend, renewals, trial and forecast per
//    active student.
// Each part replaces the club's rows in one transaction. A plain class with
// only Prisma, so the demo-reset CLI can build one by hand.
@Injectable()
export class AnalyticsSnapshotService {
    private readonly logger = new Logger(AnalyticsSnapshotService.name)

    constructor(private readonly prisma: PrismaService) {}

    async refresh(workspaceId: string, now: Date = new Date()): Promise<void> {
        await this.refreshHistory(workspaceId, now)
        await this.refreshRisk(workspaceId, now)
    }

    // The scheduler's hourly pass: every active club gets its risk part; the
    // history part runs at the club's night hour, or when it is missing or a
    // day old (a new club, a missed night).
    async runScheduled(now: Date = new Date()): Promise<{
        clubs: number
        history: number
        failed: number
    }> {
        const clubs = await this.prisma.workspace.findMany({
            where: { isActive: true },
            select: {
                id: true,
                timezone: true,
                analyticsRun: { select: { historyComputedAt: true } },
            },
        })
        let history = 0
        let failed = 0
        for (const ws of clubs) {
            const last = ws.analyticsRun?.historyComputedAt
            const due =
                !last ||
                now.getTime() - last.getTime() > 25 * 3600_000 ||
                (localHourInTz(now, ws.timezone) === ANALYTICS_NIGHTLY_HOUR &&
                    now.getTime() - last.getTime() > 2 * 3600_000)
            try {
                if (due) {
                    await this.refreshHistory(ws.id, now)
                    history += 1
                }
                await this.refreshRisk(ws.id, now)
            } catch (err) {
                failed += 1
                this.logger.error(
                    `Analytics snapshot of workspace ${ws.id} failed`,
                    err instanceof Error ? err.stack : String(err),
                )
            }
        }
        return { clubs: clubs.length, history, failed }
    }

    // Owner + every staff role ever held in the club: their own visits are not
    // a student's retention.
    private async staffIds(workspaceId: string, ownerId: string): Promise<Set<string>> {
        const rows = await this.prisma.workspaceMember.findMany({
            where: { workspaceId, role: { name: { in: COACHING_ROLES } } },
            select: { userId: true },
        })
        return new Set([ownerId, ...rows.map((r) => r.userId)])
    }

    async refreshHistory(workspaceId: string, now: Date = new Date()): Promise<void> {
        const ws = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { timezone: true, ownerId: true },
        })
        if (!ws) return
        // Earliest date any gym can need (UTC-12 is a day behind).
        const earliestYmd = addDaysYmd(localDateInTz(now, 'UTC'), -OCCURRENCE_HISTORY_DAYS - 1)

        const [staff, visitRows, slots, exceptions, rosterRows, sessions, bookings] =
            await Promise.all([
                this.staffIds(workspaceId, ws.ownerId),
                this.prisma.$queryRaw<
                    { userId: string; groupId: string | null; first: Date; last: Date; visits: number }[]
                >`
                    SELECT r."userId" AS "userId", s."groupId" AS "groupId",
                           MIN(r."markedAt") AS "first", MAX(r."markedAt") AS "last",
                           COUNT(*)::int AS "visits"
                    FROM "AttendanceRecord" r
                    JOIN "AttendanceSession" s ON s.id = r."sessionId"
                    WHERE r."workspaceId" = ${workspaceId}::uuid
                    GROUP BY 1, 2
                `,
                this.prisma.groupScheduleSlot.findMany({
                    where: { group: { workspaceId } },
                    select: {
                        id: true,
                        groupId: true,
                        dayOfWeek: true,
                        startTime: true,
                        effectiveFrom: true,
                        effectiveUntil: true,
                        group: { select: { gymId: true, gym: { select: { timezone: true } } } },
                    },
                }),
                this.prisma.scheduleException.findMany({
                    where: {
                        group: { workspaceId },
                        untilDate: { gte: ymdToDbDate(earliestYmd) },
                    },
                    select: { groupId: true, slotId: true, fromDate: true, untilDate: true },
                }),
                this.prisma.groupMember.groupBy({
                    by: ['groupId'],
                    where: { group: { workspaceId } },
                    _count: { _all: true },
                }),
                this.prisma.attendanceSession.findMany({
                    where: {
                        workspaceId,
                        slotId: { not: null },
                        sessionDate: { gte: ymdToDbDate(earliestYmd) },
                    },
                    select: { occurrenceKey: true, records: { select: { userId: true } } },
                }),
                this.prisma.dropInBooking.findMany({
                    where: { workspaceId, sessionDate: { gte: ymdToDbDate(earliestYmd) } },
                    select: { occurrenceKey: true, userId: true },
                }),
            ])

        const roster = new Map(rosterRows.map((r) => [r.groupId, r._count._all]))
        const present = new Map(
            sessions.map((s) => [s.occurrenceKey, new Set(s.records.map((r) => r.userId))]),
        )
        const bookingsByKey = new Map<string, string[]>()
        for (const b of bookings) {
            const list = bookingsByKey.get(b.occurrenceKey)
            if (list) list.push(b.userId)
            else bookingsByKey.set(b.occurrenceKey, [b.userId])
        }

        const occurrences: Prisma.AnalyticsSlotOccurrenceCreateManyInput[] = []
        for (const slot of slots) {
            const tz = resolveGroupSessionTz(slot.group.gym?.timezone ?? null, ws.timezone)
            const todayYmd = localDateInTz(now, tz)
            const startYmd = addDaysYmd(todayYmd, -OCCURRENCE_HISTORY_DAYS)
            // First date in the window on the slot's weekday (ISO, Mon=1).
            const startDow = ymdToDbDate(startYmd).getUTCDay() || 7
            let ymd = addDaysYmd(startYmd, (slot.dayOfWeek - startDow + 7) % 7)
            for (; ymd < todayYmd; ymd = addDaysYmd(ymd, 7)) {
                const date = ymdToDbDate(ymd)
                if (slot.effectiveFrom && date < slot.effectiveFrom) continue
                if (slot.effectiveUntil && date > slot.effectiveUntil) continue
                const cancelled = exceptions.some(
                    (e) =>
                        e.groupId === slot.groupId &&
                        (e.slotId === null || e.slotId === slot.id) &&
                        e.fromDate <= date &&
                        e.untilDate >= date,
                )
                if (cancelled) continue
                const key = scheduledOccurrenceKey(slot.id, ymd)
                const marked = present.get(key)
                const booked = bookingsByKey.get(key) ?? []
                occurrences.push({
                    workspaceId,
                    groupId: slot.groupId,
                    slotId: slot.id,
                    gymId: slot.group.gymId,
                    sessionDate: date,
                    dayOfWeek: slot.dayOfWeek,
                    startTime: slot.startTime,
                    held: marked !== undefined,
                    attended: marked ? [...marked].filter((u) => !staff.has(u)).length : 0,
                    roster: roster.get(slot.groupId) ?? 0,
                    capacity: null,
                    booked: booked.length,
                    missedBookings: booked.filter((u) => !marked?.has(u)).length,
                })
            }
        }

        const stats = visitRows
            .filter((r) => !staff.has(r.userId))
            .map((r) => ({
                workspaceId,
                userId: r.userId,
                groupId: r.groupId,
                firstVisitAt: r.first,
                lastVisitAt: r.last,
                visits: Number(r.visits),
            }))

        await this.prisma.$transaction([
            this.prisma.analyticsMemberGroupStat.deleteMany({ where: { workspaceId } }),
            this.prisma.analyticsMemberGroupStat.createMany({ data: stats }),
            this.prisma.analyticsSlotOccurrence.deleteMany({ where: { workspaceId } }),
            this.prisma.analyticsSlotOccurrence.createMany({ data: occurrences }),
            this.prisma.analyticsRun.upsert({
                where: { workspaceId },
                create: { workspaceId, historyComputedAt: now },
                update: { historyComputedAt: now },
            }),
        ])
    }

    async refreshRisk(workspaceId: string, now: Date = new Date()): Promise<void> {
        const ws = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { timezone: true, ownerId: true },
        })
        if (!ws) return
        const tz = ws.timezone
        const todayYmd = localDateInTz(now, tz)
        const subsSince = new Date(now.getTime() - SUBSCRIPTION_HISTORY_DAYS * DAY_MS)

        const members = await this.prisma.workspaceMember.findMany({
            where: {
                workspaceId,
                status: 'ACTIVE',
                role: { name: 'user' },
                userId: { not: ws.ownerId },
                user: { deletedAt: null },
            },
            select: {
                userId: true,
                createdAt: true,
                subscriptions: {
                    where: {
                        OR: [
                            { status: 'ACTIVE', OR: [{ endDate: null }, { endDate: { gt: now } }] },
                            { createdAt: { gte: subsSince } },
                            { endDate: { gte: subsSince } },
                        ],
                    },
                    select: {
                        id: true,
                        status: true,
                        startDate: true,
                        endDate: true,
                        createdAt: true,
                        paidAt: true,
                        isPaid: true,
                        amountPaid: true,
                        currency: true,
                        classesRemaining: true,
                        durationDays: true,
                        plan: { select: { name: true, isFreeTrial: true, durationDays: true } },
                        ...subscriptionScopeIdsSelect,
                    },
                },
            },
        })
        const U = { userId: { in: members.map((m) => m.userId) } }
        const windowStart = new Date(now.getTime() - CHURN_RULES.windowDays * DAY_MS)
        const bookingsFrom = ymdToDbDate(addDaysYmd(todayYmd, -CHURN_RULES.missedBookingWindowDays))

        const [bounds, windowRows, probe, freezes, groupRows, bookings] = await Promise.all([
            this.prisma.attendanceRecord.groupBy({
                by: ['userId'],
                where: { workspaceId, ...U },
                _min: { markedAt: true },
                _max: { markedAt: true },
            }),
            this.prisma.attendanceRecord.findMany({
                where: { workspaceId, markedAt: { gte: windowStart }, ...U },
                select: { userId: true, markedAt: true },
            }),
            this.prisma.attendanceRecord.findFirst({
                where: {
                    workspaceId,
                    markedAt: { gte: new Date(now.getTime() - CHURN_RULES.activityGuardDays * DAY_MS) },
                },
                select: { id: true },
            }),
            this.prisma.subscriptionFreeze.findMany({
                where: {
                    workspaceId,
                    ...U,
                    fromDate: { lte: ymdToDbDate(addDaysYmd(todayYmd, FREEZE_LOOKAHEAD_DAYS)) },
                    untilDate: { gte: ymdToDbDate(addDaysYmd(todayYmd, -CHURN_RULES.windowDays)) },
                },
                select: {
                    userId: true,
                    subscriptionId: true,
                    untilDate: true,
                    subscription: { select: { status: true } },
                },
            }),
            this.prisma.groupMember.findMany({
                where: { group: { workspaceId }, ...U },
                select: { userId: true, groupId: true },
            }),
            this.prisma.dropInBooking.findMany({
                where: {
                    workspaceId,
                    ...U,
                    sessionDate: { gte: bookingsFrom, lt: ymdToDbDate(todayYmd) },
                },
                select: { userId: true, occurrenceKey: true },
            }),
        ])
        const attendedBookings = bookings.length
            ? await this.prisma.attendanceRecord.findMany({
                  where: {
                      workspaceId,
                      userId: { in: [...new Set(bookings.map((b) => b.userId))] },
                      session: { occurrenceKey: { in: bookings.map((b) => b.occurrenceKey) } },
                  },
                  select: { userId: true, session: { select: { occurrenceKey: true } } },
              })
            : []

        const boundsByUser = new Map(bounds.map((b) => [b.userId, b]))
        const visitsByUser = new Map<string, Date[]>()
        for (const r of windowRows) {
            const list = visitsByUser.get(r.userId)
            if (list) list.push(r.markedAt)
            else visitsByUser.set(r.userId, [r.markedAt])
        }
        // Same freeze rules as «Кто пропадает» (load-workspace-risk.ts).
        const frozenSubs = new Map<string, Map<string, Date>>()
        const lastFreezeEnd = new Map<string, Date>()
        for (const f of freezes) {
            if (dbDateToYmd(f.untilDate) >= todayYmd) {
                if (f.subscription.status !== 'ACTIVE') continue
                const subs = frozenSubs.get(f.userId) ?? new Map<string, Date>()
                const prev = subs.get(f.subscriptionId)
                if (!prev || f.untilDate > prev) subs.set(f.subscriptionId, f.untilDate)
                frozenSubs.set(f.userId, subs)
                continue
            }
            const end = wallClockToUtc(`${addDaysYmd(dbDateToYmd(f.untilDate), 1)}T00:00`, tz)
            const prev = lastFreezeEnd.get(f.userId)
            if (!prev || end > prev) lastFreezeEnd.set(f.userId, end)
        }
        const groupsByUser = new Map<string, string[]>()
        for (const g of groupRows) {
            const list = groupsByUser.get(g.userId)
            if (list) list.push(g.groupId)
            else groupsByUser.set(g.userId, [g.groupId])
        }
        const came = new Set(attendedBookings.map((r) => `${r.userId}|${r.session.occurrenceKey}`))
        const missedByUser = new Map<string, number>()
        for (const b of bookings) {
            if (came.has(`${b.userId}|${b.occurrenceKey}`)) continue
            missedByUser.set(b.userId, (missedByUser.get(b.userId) ?? 0) + 1)
        }

        const attendanceActive = probe !== null
        const computed = members.map((m) => {
            const b = boundsByUser.get(m.userId)
            const forecastSubs: ForecastSubscription[] = m.subscriptions.map((s) => ({
                id: s.id,
                status: s.status,
                startDate: s.startDate,
                endDate: s.endDate,
                createdAt: s.createdAt,
                durationDays: s.durationDays ?? s.plan.durationDays,
                amountPaid: s.amountPaid,
                isTrial: s.plan.isFreeTrial,
                directionIds: scopeDirectionIds(s).sort(),
            }))
            const current = m.subscriptions.filter((s) => isSubscriptionUsable(s, now))
            const frozen = frozenSubs.get(m.userId)
            const frozenNow = isFrozenNow(current, frozen ? new Set(frozen.keys()) : undefined)
            const churn = computeChurnScore({
                now,
                tz,
                attendanceActive,
                joinedAt: m.createdAt,
                firstVisitAt: b?._min.markedAt ?? null,
                lastVisitAt: b?._max.markedAt ?? null,
                windowVisits: visitsByUser.get(m.userId) ?? [],
                frozenUntil:
                    frozenNow && frozen
                        ? new Date(Math.max(...[...frozen.values()].map((d) => d.getTime())))
                        : null,
                lastFreezeEndAt: lastFreezeEnd.get(m.userId) ?? null,
                subscriptions: m.subscriptions.map((s) => ({
                    status: s.status,
                    startDate: s.startDate,
                    endDate: s.endDate,
                    classesRemaining: s.classesRemaining,
                    planName: s.plan.name,
                    isTrial: s.plan.isFreeTrial,
                    isPaid: s.isPaid,
                    amountPaid: s.amountPaid,
                    currency: s.currency,
                    createdAt: s.createdAt,
                })),
                missedBookings: missedByUser.get(m.userId) ?? 0,
            })
            const latestPaid = m.subscriptions
                .filter((s) => !s.plan.isFreeTrial && s.amountPaid > 0)
                .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0]
            return {
                m,
                b,
                churn,
                forecastSubs,
                spend: monthlySpend(
                    now,
                    m.subscriptions.map((s) => ({ ...s, isTrial: s.plan.isFreeTrial })),
                ),
                currency: latestPaid?.currency ?? null,
                renewals: renewalHistory(now, forecastSubs),
                trial: trialFacts(forecastSubs),
            }
        })

        const due = computed.reduce((sum, c) => sum + c.renewals.due, 0)
        const done = computed.reduce((sum, c) => sum + c.renewals.done, 0)
        const club = clubRenewalRate(due, done)

        const rows: Prisma.AnalyticsMemberSnapshotCreateManyInput[] = computed.map((c) => {
            const p = memberRenewalProbability(club.effective, c.churn.score)
            const f = memberForecast(now, c.forecastSubs, p)
            return {
                workspaceId,
                userId: c.m.userId,
                score: c.churn.score,
                reasons: c.churn.reasons,
                monthlySpend: c.spend,
                currency: c.currency,
                groupIds: groupsByUser.get(c.m.userId) ?? [],
                firstVisitAt: c.b?._min.markedAt ?? null,
                lastVisitAt: c.b?._max.markedAt ?? null,
                renewalProbability: p,
                ...f,
                renewalsDue: c.renewals.due,
                renewalsDone: c.renewals.done,
                trialStartedAt: c.trial.trialStartedAt,
                trialConvertedAt: c.trial.trialConvertedAt,
                computedAt: now,
            }
        })

        await this.prisma.$transaction([
            this.prisma.analyticsMemberSnapshot.deleteMany({ where: { workspaceId } }),
            this.prisma.analyticsMemberSnapshot.createMany({ data: rows }),
            this.prisma.analyticsRun.upsert({
                where: { workspaceId },
                create: {
                    workspaceId,
                    riskComputedAt: now,
                    clubRenewalRate: club.rate,
                    renewalSample: due,
                },
                update: { riskComputedAt: now, clubRenewalRate: club.rate, renewalSample: due },
            }),
        ])
    }
}
