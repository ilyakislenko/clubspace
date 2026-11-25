import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn } from '../support/actors'
import { addMember, createPlan, createUser, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'
import { addOrgStaff, createOrganization, linkClub } from './org-fixtures'

const DAY = 24 * 3600_000
const ago = (days: number) => new Date(Date.now() - days * DAY)

// «Клубы» of the org console (docs/design/2026-11-26-federation-hub-mvp.md
// §3.1): the numbers are the club's own glossary functions, so they equal
// the club's dashboard and «Удержание»; money only per club opt-in.
describe('federation metrics', () => {
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

    // A club with four students: s1 at a class 3 days ago (joined 10 days
    // ago), s2 only opened the app 5 days ago, s3 last class 60 days ago
    // (joined 90 days ago), s4 at a class 10 days ago; abonements for money;
    // three newcomers of half a year ago in the visit history, two still
    // training (the 3-month cohort cell).
    const setup = async () => {
        const { workspace, owner } = await createWorkspace(ctx, { name: 'ACADEMY' })
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
        const sell = (memberId: string, s: { amount: number; from: number; days: number }) =>
            ctx.prisma.subscription.create({
                data: {
                    workspaceId: w,
                    planId: plan.id,
                    workspaceMemberId: memberId,
                    status: 'ACTIVE',
                    startDate: ago(s.from),
                    endDate: ago(s.from - s.days),
                    durationDays: s.days,
                    amountPaid: s.amount,
                    currency: 'RUB',
                    isPaid: true,
                    paidAt: ago(s.from),
                    createdAt: ago(s.from),
                },
            })
        const s1 = await addMember(ctx, { workspaceId: w })
        await ctx.prisma.workspaceMember.update({ where: { id: s1.member.id }, data: { createdAt: ago(10) } })
        await visit(s1.user.id, 3)
        await sell(s1.member.id, { amount: 6000, from: 10, days: 30 })
        const s2 = await addMember(ctx, { workspaceId: w })
        await ctx.prisma.workspaceMember.update({ where: { id: s2.member.id }, data: { lastSeenAt: ago(5), createdAt: ago(40) } })
        const s3 = await addMember(ctx, { workspaceId: w })
        await ctx.prisma.workspaceMember.update({ where: { id: s3.member.id }, data: { createdAt: ago(90) } })
        await visit(s3.user.id, 60)
        const s4 = await addMember(ctx, { workspaceId: w })
        await ctx.prisma.workspaceMember.update({ where: { id: s4.member.id }, data: { createdAt: ago(50) } })
        await visit(s4.user.id, 10)
        await sell(s4.member.id, { amount: 3000, from: 5, days: 30 })

        for (const [user, lastDaysAgo] of [
            [s1.user.id, 3],
            // Stopped a month after the first visit: not retained at 3 months.
            [s3.user.id, 150],
            [s4.user.id, 10],
        ] as const) {
            await ctx.prisma.analyticsMemberGroupStat.create({
                data: { workspaceId: w, userId: user, groupId: null, firstVisitAt: ago(180), lastVisitAt: ago(lastDaysAgo), visits: 20 },
            })
        }

        const org = await createOrganization(ctx)
        const link = await linkClub(ctx, { organizationId: org.id, workspaceId: w })
        const head = await createUser(ctx, { email: 'head@federation.test' })
        await addOrgStaff(ctx, { organizationId: org.id, userId: head.id, role: 'ORG_COACH' })
        return {
            w,
            org,
            link,
            ownerActor: await signIn(ctx, owner.email),
            orgActor: await signIn(ctx, 'head@federation.test'),
        }
    }

    it('club numbers in the org console equal the club dashboard', async () => {
        const { w, org, ownerActor, orgActor } = await setup()
        const club = (p: string) =>
            http().get(`/workspaces/${w}${p}`).set(...ownerActor.auth).expect(200).then((r) => r.body)
        const [stats, cohorts, console] = await Promise.all([
            club('/stats'),
            club('/analytics/cohorts'),
            http().get(`/orgs/${org.id}/clubs`).set(...orgActor.auth).expect(200).then((r) => r.body),
        ])
        const m = console.data[0].metrics

        expect(m.students).toBe(stats.counts.students)
        expect(m.activeStudents).toBe(stats.counts.activeStudents)
        expect(m.attended30d).toBe(stats.attendance.attendedStudents30d)
        const cell = cohorts.average.find((c: { offset: number }) => c.offset === 3)
        expect(m.newcomerRetention3m).toEqual({ rate: cell.rate, eligible: cell.eligible })

        // The fixture's own truth, so equal-but-wrong can't pass.
        expect(m).toMatchObject({
            students: 4,
            activeStudents: 3,
            attended30d: 2,
            // s1 (10 days) only: s2 joined 40 days ago, s4 50, s3 90.
            new30d: 1,
            newcomerRetention3m: { rate: 2 / 3, eligible: 3 },
        })
        expect(console.totals).toMatchObject({ activeClubs: 1, students: 4, activeStudents: 3, attended30d: 2, new30d: 1 })
        // No person-level data in the console's club row.
        expect(JSON.stringify(console.data[0])).not.toMatch(/userId|email|firstname/)
    })

    it('money appears only after the club opts in per metric', async () => {
        const { w, org, link, ownerActor, orgActor } = await setup()
        const consoleRow = () =>
            http().get(`/orgs/${org.id}/clubs`).set(...orgActor.auth).expect(200).then((r) => r.body)
        const stats = await http().get(`/workspaces/${w}/stats`).set(...ownerActor.auth).expect(200).then((r) => r.body)

        const hidden = await consoleRow()
        expect(hidden.data[0].metrics).toMatchObject({ mrr: null, revenue30d: null })
        expect(hidden.totals).toMatchObject({ mrr: null, revenue30d: null })
        expect(JSON.stringify(hidden)).not.toContain(String(stats.revenue.mrr))

        // «Регулярный доход в месяц» opened: that figure only, equal to the dashboard's.
        const sharing = (patch: Record<string, boolean>) =>
            http()
                .patch(`/workspaces/${w}/organizations/${link.id}/sharing`)
                .set(...ownerActor.auth)
                .send(patch)
                .expect(200)
        await sharing({ shareMrr: true })
        const mrrOnly = await consoleRow()
        expect(mrrOnly.data[0].metrics.mrr).toEqual({ amount: stats.revenue.mrr, currency: 'RUB' })
        expect(mrrOnly.data[0].metrics.revenue30d).toBeNull()
        expect(mrrOnly.totals.mrr).toEqual({ amount: stats.revenue.mrr, currency: 'RUB', clubs: 1 })

        await sharing({ shareRevenue30d: true })
        const both = await consoleRow()
        expect(both.data[0].metrics.revenue30d).toEqual({ amount: stats.revenue.revenue30d, currency: 'RUB' })
        expect(stats.revenue).toMatchObject({ mrr: 9000, revenue30d: 9000 })

        // Closing it again hides it on the next read.
        await sharing({ shareMrr: false, shareRevenue30d: false })
        const closed = await consoleRow()
        expect(closed.data[0].metrics).toMatchObject({ mrr: null, revenue30d: null })

        // A head coach of the club cannot open club money to anyone.
        const head = await addMember(ctx, { workspaceId: w, role: RolesEnum.HEAD_COACH })
        const headActor = await signIn(ctx, head.user.email as string)
        await http()
            .patch(`/workspaces/${w}/organizations/${link.id}/sharing`)
            .set(...headActor.auth)
            .send({ shareMrr: true })
            .expect(403)
    })
})
