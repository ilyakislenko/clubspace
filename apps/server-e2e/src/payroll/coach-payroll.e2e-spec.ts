import { localDateInTz } from '../../../server/src/features/attendance/attendance-utils'
import { shiftMonth } from '../../../server/src/domains/metrics/revenue'
import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn, type Actor } from '../support/actors'
import { addMember, createGroupWithSlot, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const TZ = 'Europe/Moscow'
const TODAY = localDateInTz(new Date(), TZ)
const CURRENT = TODAY.slice(0, 7)
const LAST = shiftMonth(CURRENT, -1)
// Two classes a week apart in last month, on the same weekday.
const D1 = `${LAST}-10`
const D2 = `${LAST}-17`
const isoDow = (ymd: string) => {
    const d = new Date(`${ymd}T00:00:00Z`).getUTCDay()
    return d === 0 ? 7 : d
}

// «Выплаты тренерам» (docs/design/2026-11-26-coach-payroll.md §9).
describe('coach payroll', () => {
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

    const memberActor = async (workspaceId: string, role?: RolesEnum, firstname?: string) => {
        const { user } = await addMember(ctx, { workspaceId, role })
        if (firstname) await ctx.prisma.user.update({ where: { id: user.id }, data: { firstname } })
        return { user, actor: await signIn(ctx, user.email!) }
    }

    // A club whose owner has no member row; `anna` coaches a group on D1's
    // weekday (last month) and on today's weekday; `boris` is another coach.
    const setup = async () => {
        const { workspace, owner } = await createWorkspace(ctx, { ownerMembership: false })
        const w = workspace.id
        const ownerActor = await signIn(ctx, owner.email!)
        const anna = await memberActor(w, RolesEnum.COACH, 'Анна')
        const boris = await memberActor(w, RolesEnum.COACH, 'Борис')
        const head = await memberActor(w, RolesEnum.HEAD_COACH, 'Глеб')
        const s1 = await memberActor(w, undefined, 'Ученик1')
        const s2 = await memberActor(w, undefined, 'Ученик2')
        const s3 = await memberActor(w, undefined, 'Ученик3')
        const past = await createGroupWithSlot(ctx, {
            workspaceId: w,
            coachUserId: anna.user.id,
            dayOfWeek: isoDow(D1),
            gymTimezone: null,
            name: 'Утро',
        })
        return { w, owner, ownerActor, anna, boris, head, s1, s2, s3, past }
    }
    type Club = Awaited<ReturnType<typeof setup>>

    const base = (c: Club) => `/workspaces/${c.w}/payroll`

    const openClass = async (actor: Actor, c: Club, slotId: string, sessionDate: string) =>
        (
            await http()
                .post(`/workspaces/${c.w}/attendance/sessions`)
                .set(...actor.auth)
                .send({ kind: 'scheduled', slotId, sessionDate })
                .expect(201)
        ).body as { id: string; coachId?: string }

    const mark = (actor: Actor, c: Club, sessionId: string, userIds: string[]) =>
        http()
            .post(`/workspaces/${c.w}/attendance/sessions/${sessionId}/records`)
            .set(...actor.auth)
            .send({ userIds })
            .expect(201)

    const setRate = (actor: Actor, c: Club, coachId: string, body: Record<string, unknown>) =>
        http()
            .put(`${base(c)}/rates/${coachId}`)
            .set(...actor.auth)
            .send({
                effectiveFrom: LAST,
                fixedMonthly: 0,
                perClass: 0,
                perClassMinStudents: 1,
                perStudent: 0,
                revenueBp: 0,
                ...body,
            })

    const getMonth = async (actor: Actor, c: Club, month = LAST) =>
        (await http().get(base(c)).query({ month }).set(...actor.auth).expect(200)).body

    const close = (actor: Actor, c: Club, expectedTotal: number, month = LAST) =>
        http().post(`${base(c)}/${month}/close`).set(...actor.auth).send({ expectedTotal })

    // Anna's two classes last month: 3 marks and 1 mark.
    const lastMonthClasses = async (c: Club) => {
        const a = await openClass(c.ownerActor, c, c.past.slot.id, D1)
        await mark(c.ownerActor, c, a.id, [c.s1.user.id, c.s2.user.id, c.s3.user.id])
        const b = await openClass(c.ownerActor, c, c.past.slot.id, D2)
        await mark(c.ownerActor, c, b.id, [c.s1.user.id])
        return { a, b }
    }

    it('owner sets rates and sees last month’s payouts', async () => {
        const c = await setup()
        await lastMonthClasses(c)
        const rate = await setRate(c.ownerActor, c, c.anna.user.id, {
            fixedMonthly: 10000,
            perClass: 1500,
            perClassMinStudents: 3,
            perStudent: 100,
        }).expect(200)
        expect(rate.body).toMatchObject({ effectiveFrom: LAST, perClass: 1500, currency: 'RUB' })

        const rates = await http().get(`${base(c)}/rates`).set(...c.ownerActor.auth).expect(200)
        const annaRates = rates.body.coaches.find((x: { coachId: string }) => x.coachId === c.anna.user.id)
        expect(annaRates.rates).toHaveLength(1)
        expect(annaRates.updatedAt).toBe(rate.body.updatedAt)
        expect(rates.body.coaches.find((x: { role: string }) => x.role === 'owner')).toBeDefined()

        const month = await getMonth(c.ownerActor, c)
        expect(month).toMatchObject({ month: LAST, status: 'open', canClose: true, currency: 'RUB' })
        const anna = month.lines.find((l: { coachId: string }) => l.coachId === c.anna.user.id)
        // 2 classes, 1 paid (3 marks ≥ 3); per-mark pays the paid class's 3.
        expect(anna).toMatchObject({
            name: 'Анна',
            classes: 2,
            classesPaid: 1,
            marks: 4,
            marksPaid: 3,
            amounts: { fixed: 10000, classes: 1500, students: 300, revenue: 0, adjustments: 0 },
            total: 11800,
        })
        expect(month.total).toBe(11800)

        const classes = await http()
            .get(`${base(c)}/coaches/${c.anna.user.id}/classes`)
            .query({ month: LAST })
            .set(...c.ownerActor.auth)
            .expect(200)
        expect(classes.body.items.map((i: { date: string; status: string }) => [i.date, i.status])).toEqual([
            [D1, 'paid'],
            [D2, 'unpaid'],
        ])

        // A rate from this month on leaves last month as it was.
        await setRate(c.ownerActor, c, c.anna.user.id, { effectiveFrom: CURRENT, perClass: 9999 }).expect(200)
        expect((await getMonth(c.ownerActor, c)).total).toBe(11800)
    })

    it('a substitute is credited, the group coach is not', async () => {
        const c = await setup()
        await ctx.prisma.classSubstitution.create({
            data: {
                workspaceId: c.w,
                groupId: c.past.group.id,
                slotId: c.past.slot.id,
                sessionDate: new Date(`${D1}T00:00:00Z`),
                occurrenceKey: `slot:${c.past.slot.id}:${D1}`,
                substituteId: c.boris.user.id,
                kind: 'ASSIGN',
                status: 'APPROVED',
                requestedById: c.owner.id,
                decidedById: c.owner.id,
            },
        })
        const s = await openClass(c.ownerActor, c, c.past.slot.id, D1)
        await mark(c.ownerActor, c, s.id, [c.s1.user.id])
        await setRate(c.ownerActor, c, c.boris.user.id, { perClass: 2000 }).expect(200)
        await setRate(c.ownerActor, c, c.anna.user.id, { perClass: 2000 }).expect(200)

        const month = await getMonth(c.ownerActor, c)
        const line = (id: string) => month.lines.find((l: { coachId: string }) => l.coachId === id)
        expect(line(c.boris.user.id)).toMatchObject({ classes: 1, total: 2000 })
        expect(line(c.anna.user.id)).toMatchObject({ classes: 0, total: 0 })

        const borisClasses = await http()
            .get(`${base(c)}/coaches/${c.boris.user.id}/classes`)
            .query({ month: LAST })
            .set(...c.ownerActor.auth)
            .expect(200)
        expect(borisClasses.body.items).toEqual([expect.objectContaining({ status: 'paid', substitute: true })])
        const annaClasses = await http()
            .get(`${base(c)}/coaches/${c.anna.user.id}/classes`)
            .query({ month: LAST })
            .set(...c.ownerActor.auth)
            .expect(200)
        expect(annaClasses.body.items).toEqual([
            expect.objectContaining({ status: 'other_coach', ranBy: { coachId: c.boris.user.id, name: 'Борис' } }),
        ])
    })

    it('a class cancelled after attendance does not count', async () => {
        const c = await setup()
        await lastMonthClasses(c)
        await setRate(c.ownerActor, c, c.anna.user.id, { perClass: 1000 }).expect(200)
        expect((await getMonth(c.ownerActor, c)).total).toBe(2000)

        await http()
            .post(`/workspaces/${c.w}/groups/${c.past.group.id}/schedule/exceptions`)
            .set(...c.ownerActor.auth)
            .send({ slotId: c.past.slot.id, fromDate: D2, untilDate: D2, reason: 'Зал закрыт' })
            .expect(201)
        const month = await getMonth(c.ownerActor, c)
        expect(month.lines[0]).toMatchObject({ classes: 1, total: 1000 })
        const classes = await http()
            .get(`${base(c)}/coaches/${c.anna.user.id}/classes`)
            .query({ month: LAST })
            .set(...c.ownerActor.auth)
            .expect(200)
        expect(classes.body.items.map((i: { status: string }) => i.status)).toEqual(['paid', 'cancelled'])
    })

    it('percent rate splits a paid abonement by visits', async () => {
        const c = await setup()
        const dow = isoDow(TODAY)
        const g1 = await createGroupWithSlot(ctx, { workspaceId: c.w, coachUserId: c.anna.user.id, dayOfWeek: dow, gymTimezone: null, startTime: '10:00' })
        const g2 = await createGroupWithSlot(ctx, { workspaceId: c.w, coachUserId: c.boris.user.id, dayOfWeek: dow, gymTimezone: null, startTime: '12:00' })
        const plan = await createPlan(ctx, { workspaceId: c.w, price: 3001, classCount: 8 })
        await http()
            .post(`/workspaces/${c.w}/members/${c.s1.user.id}/subscription`)
            .set(...c.ownerActor.auth)
            .send({ planId: plan.id })
            .expect(201)
        const a = await openClass(c.ownerActor, c, g1.slot.id, TODAY)
        await mark(c.ownerActor, c, a.id, [c.s1.user.id])
        const b = await openClass(c.ownerActor, c, g2.slot.id, TODAY)
        await mark(c.ownerActor, c, b.id, [c.s1.user.id])
        await setRate(c.ownerActor, c, c.anna.user.id, { effectiveFrom: CURRENT, revenueBp: 1000 }).expect(200)
        await setRate(c.ownerActor, c, c.boris.user.id, { effectiveFrom: CURRENT, revenueBp: 2000 }).expect(200)

        const month = await getMonth(c.ownerActor, c, CURRENT)
        expect(month).toMatchObject({ status: 'open', canClose: false })
        const line = (id: string) => month.lines.find((l: { coachId: string }) => l.coachId === id)
        // 3001 split 1:1 by largest remainder; the parts sum to the sale.
        expect(line(c.anna.user.id).revenueBase + line(c.boris.user.id).revenueBase).toBe(3001)
        expect([line(c.anna.user.id).revenueBase, line(c.boris.user.id).revenueBase].sort()).toEqual([1500, 1501])
        expect(line(c.anna.user.id).amounts.revenue).toBe(Math.round(line(c.anna.user.id).revenueBase / 10))
        expect(line(c.boris.user.id).amounts.revenue).toBe(Math.round(line(c.boris.user.id).revenueBase / 5))
        expect(month.unattributed.revenue).toBe(0)

        // An unended month cannot be closed.
        await close(c.ownerActor, c, month.total, CURRENT).expect(400)
    })

    it('closing freezes the month; later attendance edits only change drift', async () => {
        const c = await setup()
        const { b } = await lastMonthClasses(c)
        await setRate(c.ownerActor, c, c.anna.user.id, { perStudent: 100 }).expect(200)
        const before = await getMonth(c.ownerActor, c)
        expect(before.total).toBe(400)

        // A stale total is refused.
        const stale = await close(c.ownerActor, c, 399).expect(409)
        expect(stale.body).toMatchObject({ code: 'STALE_UPDATE' })
        // The right total with a wrong coach line is refused too.
        const wrongLine = await http()
            .post(`${base(c)}/${LAST}/close`)
            .set(...c.ownerActor.auth)
            .send({ expectedTotal: 400, expectedLines: [{ coachId: c.boris.user.id, total: 400 }] })
            .expect(409)
        expect(wrongLine.body).toMatchObject({ code: 'STALE_UPDATE' })

        const closed = (
            await http()
                .post(`${base(c)}/${LAST}/close`)
                .set(...c.ownerActor.auth)
                .send({ expectedTotal: 400, expectedLines: [{ coachId: c.anna.user.id, total: 400 }] })
                .expect(201)
        ).body
        expect(closed).toMatchObject({ status: 'closed', total: 400, drift: null, closedBy: { id: c.owner.id } })
        // A second close at the same moment.
        expect((await close(c.ownerActor, c, 400).expect(409)).body.message).toBe('Месяц уже закрыт')

        await mark(c.ownerActor, c, b.id, [c.s2.user.id, c.s3.user.id])
        const after = await getMonth(c.ownerActor, c)
        expect(after).toMatchObject({
            status: 'closed',
            total: 400,
            drift: 200,
            driftByCoach: [{ coachId: c.anna.user.id, name: 'Анна', delta: 200 }],
        })
        expect(after.lines[0].total).toBe(400)

        const audit = await ctx.prisma.auditEvent.findFirstOrThrow({ where: { workspaceId: c.w, action: 'payroll.closeMonth' } })
        expect(audit.metadata).toMatchObject({ month: LAST, total: 400, coaches: 1 })
    })

    it('rate change and adjustment in a closed month are refused', async () => {
        const c = await setup()
        await lastMonthClasses(c)
        await setRate(c.ownerActor, c, c.anna.user.id, { perClass: 1000 }).expect(200)
        const adj = await http()
            .post(`${base(c)}/adjustments`)
            .set(...c.ownerActor.auth)
            .send({ month: LAST, coachId: c.anna.user.id, amount: 5000, comment: 'Открытый урок' })
            .expect(201)
        expect(adj.body).toMatchObject({ amount: 5000, comment: 'Открытый урок', month: LAST })
        await http()
            .post(`${base(c)}/adjustments`)
            .set(...c.ownerActor.auth)
            .send({ month: LAST, coachId: c.anna.user.id, amount: 0, comment: 'x' })
            .expect(400)
        const month = await getMonth(c.ownerActor, c)
        expect(month.lines[0]).toMatchObject({ total: 7000, amounts: { adjustments: 5000 } })
        await close(c.ownerActor, c, 7000).expect(201)

        await setRate(c.ownerActor, c, c.anna.user.id, { perClass: 1 }).expect(409)
        await http()
            .post(`${base(c)}/adjustments`)
            .set(...c.ownerActor.auth)
            .send({ month: LAST, coachId: c.anna.user.id, amount: -100, comment: 'Удержание' })
            .expect(409)
        await http().delete(`${base(c)}/adjustments/${adj.body.id}`).set(...c.ownerActor.auth).expect(409)
        // From the open month on it is fine.
        await setRate(c.ownerActor, c, c.anna.user.id, { effectiveFrom: CURRENT, perClass: 1 }).expect(200)
        // A non-staff person is refused a rate.
        await setRate(c.ownerActor, c, c.s1.user.id, {}).expect(400)
    })

    it('a coach leaving after the close is not drift; their pay stops with the month they left', async () => {
        const c = await setup()
        await setRate(c.ownerActor, c, c.boris.user.id, { fixedMonthly: 700 }).expect(200)
        // Joined this month: an explicit rate for last month is meant (imported staff).
        const newcomer = await memberActor(c.w, RolesEnum.COACH, 'Новичок')
        await setRate(c.ownerActor, c, newcomer.user.id, { fixedMonthly: 300 }).expect(200)
        await close(c.ownerActor, c, 1000).expect(201)
        await http().delete(`/workspaces/${c.w}/members/${c.boris.user.id}`).set(...c.ownerActor.auth).expect(200)
        const after = await getMonth(c.ownerActor, c)
        expect(after).toMatchObject({ total: 1000, drift: null, driftByCoach: [] })
        // Reopened, last month was still Борис's: he left after it began.
        await http()
            .post(`${base(c)}/${LAST}/reopen`)
            .set(...c.ownerActor.auth)
            .send({ reason: 'Проверка после ухода тренера' })
            .expect(201)
        const reopened = await getMonth(c.ownerActor, c)
        expect(reopened.lines.map((l: { coachId: string; total: number }) => [l.coachId, l.total]).sort()).toEqual(
            [
                [c.boris.user.id, 700],
                [newcomer.user.id, 300],
            ].sort(),
        )
        // Next month began after he left: no row for him, the newcomer's rate runs on.
        const next = await getMonth(c.ownerActor, c, shiftMonth(CURRENT, 1))
        expect(next.lines.map((l: { coachId: string }) => l.coachId)).toEqual([newcomer.user.id])
    })

    it('reopen with a reason, close again', async () => {
        const c = await setup()
        await lastMonthClasses(c)
        await setRate(c.ownerActor, c, c.anna.user.id, { perClass: 1000 }).expect(200)
        await close(c.ownerActor, c, 2000).expect(201)

        await http().post(`${base(c)}/${LAST}/reopen`).set(...c.ownerActor.auth).send({ reason: 'a' }).expect(400)
        const reopened = await http()
            .post(`${base(c)}/${LAST}/reopen`)
            .set(...c.ownerActor.auth)
            .send({ reason: 'Ошибка в посещаемости' })
            .expect(201)
        expect(reopened.body).toMatchObject({ status: 'open', total: 2000 })
        expect(await ctx.prisma.payrollMonth.count({ where: { workspaceId: c.w } })).toBe(0)
        const audit = await ctx.prisma.auditEvent.findFirstOrThrow({ where: { workspaceId: c.w, action: 'payroll.reopenMonth' } })
        expect(audit.metadata).toMatchObject({
            month: LAST,
            reason: 'Ошибка в посещаемости',
            totalBefore: 2000,
            lines: [{ coachId: c.anna.user.id, total: 2000 }],
        })

        await http()
            .post(`${base(c)}/adjustments`)
            .set(...c.ownerActor.auth)
            .send({ month: LAST, coachId: c.anna.user.id, amount: 500, comment: 'Премия' })
            .expect(201)
        expect((await close(c.ownerActor, c, 2500).expect(201)).body).toMatchObject({ status: 'closed', total: 2500 })
    })

    it('head coach and coach get 403 on every payroll route', async () => {
        const c = await setup()
        const admin = await memberActor(c.w, RolesEnum.ADMIN)
        const routes = [
            () => http().get(base(c)).query({ month: LAST }),
            () => http().get(`${base(c)}/rates`),
            () => http().get(`${base(c)}/coaches/${c.anna.user.id}/classes`).query({ month: LAST }),
            () => http().put(`${base(c)}/rates/${c.anna.user.id}`).send({ effectiveFrom: CURRENT, fixedMonthly: 1, perClass: 0, perClassMinStudents: 1, perStudent: 0, revenueBp: 0 }),
            () => http().post(`${base(c)}/adjustments`).send({ month: CURRENT, coachId: c.anna.user.id, amount: 1, comment: 'x' }),
            () => http().delete(`${base(c)}/adjustments/00000000-0000-4000-8000-000000000000`),
            () => http().post(`${base(c)}/${LAST}/close`).send({ expectedTotal: 0 }),
            () => http().post(`${base(c)}/${LAST}/reopen`).send({ reason: 'Причина' }),
            () => http().get(`/workspaces/${c.w}/exports/payroll.csv`).query({ month: LAST }),
        ]
        for (const actor of [c.head.actor, c.anna.actor]) {
            for (const route of routes) {
                expect((await route().set(...actor.auth)).status).toBe(403)
            }
        }
        // A club admin passes.
        await http().get(base(c)).query({ month: LAST }).set(...admin.actor.auth).expect(200)
        await http().get(`${base(c)}/rates`).set(...admin.actor.auth).expect(200)
    })

    it('coach sees own closed months only when the club enables it', async () => {
        const c = await setup()
        await lastMonthClasses(c)
        // Boris runs a class today (no money shown for the current month).
        const today = await createGroupWithSlot(ctx, { workspaceId: c.w, coachUserId: c.boris.user.id, dayOfWeek: isoDow(TODAY), gymTimezone: null })
        const s = await openClass(c.ownerActor, c, today.slot.id, TODAY)
        await mark(c.ownerActor, c, s.id, [c.s1.user.id, c.s2.user.id])
        await setRate(c.ownerActor, c, c.anna.user.id, { perClass: 1000 }).expect(200)
        await setRate(c.ownerActor, c, c.boris.user.id, { fixedMonthly: 500 }).expect(200)

        const me = (actor: Actor) => http().get(`${base(c)}/me`).set(...actor.auth)
        expect((await me(c.anna.actor).expect(403)).body.message).toBe('Клуб не показывает выплаты в приложении')
        await me(c.ownerActor).expect(200)
        const membership = (actor: Actor) =>
            http().get(`/workspaces/${c.w}/members/me`).set(...actor.auth).expect(200)
        expect((await membership(c.anna.actor)).body.canSeeOwnPay).toBe(false)

        await http().patch(`/workspaces/${c.w}/settings`).set(...c.ownerActor.auth).send({ coachPayVisible: true }).expect(200)
        expect((await membership(c.anna.actor)).body.canSeeOwnPay).toBe(true)
        expect((await membership(c.s1.actor)).body.canSeeOwnPay).toBe(false)
        await close(c.ownerActor, c, 2500).expect(201)

        const anna = (await me(c.anna.actor).expect(200)).body
        expect(anna.months).toEqual([
            expect.objectContaining({ month: LAST, total: 2000, classes: 2, currency: 'RUB' }),
        ])
        const boris = (await me(c.boris.actor).expect(200)).body
        expect(boris.months).toEqual([expect.objectContaining({ month: LAST, total: 500, classes: 0 })])
        expect(boris.current).toEqual({ month: CURRENT, classes: 1, marks: 2 })
        expect(JSON.stringify(boris.current)).not.toMatch(/total|amount/)
        // A student is refused.
        await me(c.s1.actor).expect(403)

        // The push names the month, never the amount.
        const pushes = await ctx.prisma.notification.findMany({ where: { userId: c.anna.user.id } })
        const payroll = pushes.filter((n) => (n.metadata as { kind?: string } | null)?.kind === 'payroll.closed')
        expect(payroll).toHaveLength(1)
        expect(payroll[0].topic).toMatch(/^Выплаты за .+ готовы$/)
        expect(`${payroll[0].topic} ${payroll[0].message}`).not.toContain('2000')
    })

    it('payroll.csv matches the closed snapshot', async () => {
        const c = await setup()
        await lastMonthClasses(c)
        await setRate(c.ownerActor, c, c.anna.user.id, { perClass: 1000, perStudent: 10 }).expect(200)
        const closed = (await close(c.ownerActor, c, 2040).expect(201)).body
        expect(closed.total).toBe(2040)

        const res = await http()
            .get(`/workspaces/${c.w}/exports/payroll.csv`)
            .query({ month: LAST })
            .set(...c.ownerActor.auth)
            .expect(200)
        expect(res.headers['content-disposition']).toContain(`payroll-${LAST}.csv`)
        const csv = res.text
        expect(csv).toContain(`${LAST};закрыт;Анна;2;2;4;0;0;2000;40;0;0;2040;RUB`)
        expect(csv).toContain(`${LAST};закрыт;Итого;2;2;4;0;0;2000;40;0;0;2040;RUB`)
        expect(await ctx.prisma.auditEvent.count({ where: { workspaceId: c.w, action: 'export.payroll' } })).toBe(1)
    })
})
