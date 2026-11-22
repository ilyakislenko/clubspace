import { AnalyticsSnapshotService } from '../../../server/src/domains/analytics/analytics-snapshot.service'
import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn } from '../support/actors'
import { addMember, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const DAY = 24 * 3600_000

// The metric glossary (docs/design/2026-11-08-admin-cleanup.md B2): one club,
// every surface that shows a glossary metric — the dashboard, «Прогноз
// выручки», the ClubSpace bill, the members list and its filters, «Продлить» and
// «Ожидают оплаты» — and each metric reads the same number everywhere.
describe('metric glossary', () => {
    let ctx: TestApp

    beforeAll(async () => {
        ctx = await createTestApp()
    })
    afterAll(async () => {
        await ctx?.close()
    })
    beforeEach(async () => {
        await resetDatabase(ctx.prisma)
        await ctx.seed.onApplicationBootstrap()
        ctx.mail.clear()
    })

    const http = () => ctx.http()
    const ago = (days: number) => new Date(Date.now() - days * DAY)

    // Owner (with the console's admin row) and a coach; four students, a
    // pending applicant and a blocked member:
    //   s1 — at a class 3 days ago, a paid 30-day abonement (6 000);
    //   s2 — opened the app 5 days ago, no class for 30 days, an unpaid
    //        abonement (4 000);
    //   s3 — last class 60 days ago, the abonement ended 10 days ago;
    //   s4 — at a class 10 days ago, two paid 30-day abonements (3 000 each);
    //   the coach — at a class 2 days ago, holds a paid 60-day abonement (6 000);
    //   the blocked one — at a class yesterday; the applicant — seen today.
    const setup = async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const w = workspace.id
        const plan = await createPlan(ctx, { workspaceId: w, price: 6000 })

        const visit = async (userId: string, daysAgo: number) => {
            const at = ago(daysAgo)
            const session = await ctx.prisma.attendanceSession.create({
                data: {
                    workspaceId: w,
                    occurrenceKey: `adhoc:${userId}:${at.toISOString()}`,
                    title: 'Тренировка',
                    startAt: at,
                    timezone: 'Europe/Moscow',
                    createdById: owner.id,
                },
            })
            await ctx.prisma.attendanceRecord.create({
                data: { sessionId: session.id, workspaceId: w, userId, markedById: owner.id, markedAt: at },
            })
            await ctx.prisma.workspaceMember.update({
                where: { userId_workspaceId: { userId, workspaceId: w } },
                data: { lastAttendedAt: at },
            })
        }
        // Like a sale in the admin (grantFromPlan): the abonement, and the
        // member's access window extended to its end — the window a lapsed
        // student's renewal is judged by (renewal-rules.ts).
        const sell = async (
            memberId: string,
            s: { amount: number; from: number; days: number; paid: boolean; status?: 'ACTIVE' | 'EXPIRED' },
        ) => {
            const endDate = ago(s.from - s.days)
            await ctx.prisma.subscription.create({
                data: {
                    workspaceId: w,
                    planId: plan.id,
                    workspaceMemberId: memberId,
                    status: s.status ?? 'ACTIVE',
                    startDate: ago(s.from),
                    endDate,
                    durationDays: s.days,
                    amountPaid: s.amount,
                    currency: 'RUB',
                    isPaid: s.paid,
                    paidAt: s.paid ? ago(s.from) : null,
                    createdAt: ago(s.from),
                },
            })
            const { accessUntil } = await ctx.prisma.workspaceMember.findUniqueOrThrow({ where: { id: memberId } })
            if (!accessUntil || accessUntil < endDate) {
                await ctx.prisma.workspaceMember.update({ where: { id: memberId }, data: { accessUntil: endDate } })
            }
        }

        const coach = await addMember(ctx, { workspaceId: w, role: RolesEnum.COACH })
        await visit(coach.user.id, 2)
        await sell(coach.member.id, { amount: 6000, from: 3, days: 60, paid: true })

        const s1 = await addMember(ctx, { workspaceId: w })
        await visit(s1.user.id, 3)
        await sell(s1.member.id, { amount: 6000, from: 10, days: 30, paid: true })

        const s2 = await addMember(ctx, { workspaceId: w })
        await ctx.prisma.workspaceMember.update({ where: { id: s2.member.id }, data: { lastSeenAt: ago(5) } })
        await sell(s2.member.id, { amount: 4000, from: 2, days: 30, paid: false })

        const s3 = await addMember(ctx, { workspaceId: w })
        await visit(s3.user.id, 60)
        await sell(s3.member.id, { amount: 6000, from: 40, days: 30, paid: true, status: 'EXPIRED' })

        const s4 = await addMember(ctx, { workspaceId: w })
        await visit(s4.user.id, 10)
        await sell(s4.member.id, { amount: 3000, from: 5, days: 30, paid: true })
        await sell(s4.member.id, { amount: 3000, from: 5, days: 30, paid: true })

        const applicant = await addMember(ctx, { workspaceId: w, status: 'INVITED' })
        await ctx.prisma.workspaceMember.update({ where: { id: applicant.member.id }, data: { lastSeenAt: new Date() } })
        const blocked = await addMember(ctx, { workspaceId: w, status: 'BLOCKED' })
        await visit(blocked.user.id, 1)

        await ctx.app.get(AnalyticsSnapshotService).refreshRisk(w)
        const ownerActor = await signIn(ctx, owner.email)
        return { w, ownerActor }
    }

    it('shows each metric with one number on every surface', async () => {
        const { w, ownerActor } = await setup()
        const get = (path: string) =>
            http()
                .get(`/workspaces/${w}${path}`)
                .set(...ownerActor.auth)
                .expect(200)
                .then((r) => r.body)

        const [stats, forecast, billing, members, inactive, renew, unpaid, renewals, awaiting] =
            await Promise.all([
                get('/stats'),
                get('/analytics/forecast'),
                get('/billing'),
                get('/members?perPage=1'),
                get('/members?perPage=1&access=inactive'),
                get('/members?perPage=1&access=renew'),
                get('/members?perPage=1&access=unpaid'),
                get('/renewal-candidates?perPage=1'),
                get('/awaiting-payment?perPage=1'),
            ])

        // members_total: everyone on the roster but the applicant — the
        // owner's row, the coach, four students, the blocked member.
        expect(members.total).toBe(7)

        // students_total: active student memberships only.
        expect(stats.counts.students).toBe(4)
        expect(forecast.students).toBe(4)

        // students_active: at a class or in the app within 30 days (s1, s2,
        // s4) — the figure the bill is priced by.
        expect(stats.counts.activeStudents).toBe(3)
        expect(billing.billing.activeMembers).toBe(3)

        // students_with_abonement: people, not abonements (s4 holds two, the
        // coach's own abonement is not a student's).
        expect(stats.counts.studentsWithAbonement).toBe(3)

        // students_attended_30d + students_not_attended_30d = students_total;
        // the members filter «inactive» is the same set.
        expect(stats.attendance.attendedStudents30d).toBe(2)
        expect(stats.attendance.attendedStudents7d).toBe(1)
        expect(stats.retention.notAttended30d).toBe(2)
        expect(inactive.total).toBe(stats.retention.notAttended30d)
        expect(stats.attendance.checkins30d).toBe(2)

        // mrr: every current paid abonement over 30 days, whoever holds it:
        // s1 6 000 + s4 3 000 × 2 + the coach's 60-day 6 000 → 3 000.
        expect(stats.revenue.mrr).toBe(15000)
        expect(forecast.mrr).toBe(stats.revenue.mrr)

        // revenue_30d: paid in the last 30 days (s3's sale is 40 days old).
        expect(stats.revenue.revenue30d).toBe(18000)

        // expected_revenue_30d: the dashboard tile is the forecast's horizon.
        expect(stats.revenue.expected30d).toBe(forecast.horizons[0].expected)

        // awaiting_payment: s2 owes 4 000 — the tile, the list header and the
        // members filter «Должники».
        expect(stats.revenue.awaitingPayment).toEqual({ students: 1, amount: 4000 })
        expect(awaiting.members).toBe(1)
        expect(unpaid.total).toBe(1)

        // renewals_due: s3, whose abonement ended 10 days ago (everyone else's
        // runs past the 7-day window) — the tile, the «Продлить» list and the
        // members filter.
        expect(stats.retention.renewalsDue).toBe(1)
        expect(renewals.total).toBe(stats.retention.renewalsDue)
        expect(renew.total).toBe(stats.retention.renewalsDue)
    })

    it('one refund: every revenue surface reads the same net number', async () => {
        const { w, ownerActor } = await setup()
        const get = (path: string) =>
            http()
                .get(`/workspaces/${w}${path}`)
                .set(...ownerActor.auth)
                .expect(200)
                .then((r) => r.body)
        // s1's 6 000 abonement (a 30-day term): 1 500 handed back in cash.
        const s1Sale = await ctx.prisma.subscription.findFirstOrThrow({
            where: { workspaceId: w, amountPaid: 6000, durationDays: 30, isPaid: true, status: 'ACTIVE' },
        })
        await http()
            .post(`/workspaces/${w}/refunds`)
            .set(...ownerActor.auth)
            .send({ target: 'abonement', targetId: s1Sale.id, amount: 1500, method: 'CASH', reason: 'Болел' })
            .expect(201)

        const [stats, forecast, journal, plan] = await Promise.all([
            get('/stats'),
            get('/analytics/forecast'),
            get('/payment-journal'),
            get(`/plans/${s1Sale.planId}`),
        ])
        // revenue_30d = payments_received − refunds: 18 000 − 1 500.
        expect(stats.revenue.revenue30d).toBe(16500)
        expect(journal.totals[0]).toMatchObject({ received: 18000, refunded: 1500, net: 16500 })
        // The tariff page: its sales in the window − its abonements' refunds.
        expect(plan.last30Days.revenue).toBe(16500)
        // mrr: s1 counts (6 000 − 1 500) × 30 / 30.
        expect(stats.revenue.mrr).toBe(15000 - 1500)
        expect(forecast.mrr).toBe(stats.revenue.mrr)
    })

    // discounts_given (docs/design/2026-11-15-discounts.md §3.5): s1's 6 000
    // abonement was sold at 4 500 (a 1 000 «Семейная» and a 500 one-off).
    // Revenue keeps reading what was charged; the discount is shown beside it,
    // never subtracted again.
    it('a discounted sale: revenue is the charged amount, discounts_given the difference', async () => {
        const { w, ownerActor } = await setup()
        const get = (path: string) =>
            http()
                .get(`/workspaces/${w}${path}`)
                .set(...ownerActor.auth)
                .expect(200)
                .then((r) => r.body)
        const s1Sale = await ctx.prisma.subscription.findFirstOrThrow({
            where: { workspaceId: w, amountPaid: 6000, durationDays: 30, isPaid: true, status: 'ACTIVE' },
        })
        await ctx.prisma.subscription.update({
            where: { id: s1Sale.id },
            data: { amountPaid: 4500, listPrice: 6000, discountName: 'Семейная', discountAmount: 1000 },
        })
        const [stats, journal] = await Promise.all([get('/stats'), get('/payment-journal')])
        // revenue_30d: 18 000 − 1 500 not charged.
        expect(stats.revenue.revenue30d).toBe(16500)
        // The journal's default «Итого» is still revenue_30d.
        expect(journal.totals[0].net).toBe(stats.revenue.revenue30d)
        // discounts_given = list − charged, named and one-off parts.
        expect(journal.totals[0].discounted).toEqual({ count: 1, amount: 1500, oneOffAmount: 500 })
    })

    it('keeps club money for club admins: a head coach gets the counts without it', async () => {
        const { w } = await setup()
        const lead = await addMember(ctx, { workspaceId: w, role: RolesEnum.HEAD_COACH })
        const actor = await signIn(ctx, lead.user.email!)
        const stats = await http().get(`/workspaces/${w}/stats`).set(...actor.auth).expect(200)
        expect(stats.body.revenue).toBeNull()
        expect(stats.body.counts).toMatchObject({ students: 4, activeStudents: 3, studentsWithAbonement: 3 })
        await http().get(`/workspaces/${w}/analytics/forecast`).set(...actor.auth).expect(403)
        await http().get(`/workspaces/${w}/billing`).set(...actor.auth).expect(403)
    })
})
