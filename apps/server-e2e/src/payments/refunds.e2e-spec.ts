import { setTimeout as sleep } from 'node:timers/promises'

import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { type Actor, signIn } from '../support/actors'
import { FakeGateway } from '../support/fake-payment-gateway'
import { addMember, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const HOUR_MS = 3600_000

// Возвраты (docs/design/2026-11-15-payments-journal.md, phase B): a refund
// is recorded once, any method, and every revenue figure nets it out by
// refund date; online refunds go through the provider (FakeGateway) with a
// receipt for a part, a double submit records one refund; refunded and online
// sales can't be unmarked; a full refund of an upcoming ticket frees the place
// to the waitlist.
describe('refunds', () => {
    let ctx: TestApp
    const gateway = new FakeGateway()

    beforeAll(async () => {
        ctx = await createTestApp({ paymentGateway: gateway })
    })
    afterAll(async () => {
        await ctx?.close()
    })
    beforeEach(async () => {
        await resetDatabase(ctx.prisma)
        await ctx.seed.onApplicationBootstrap()
        gateway.reset()
    })

    const wall = (d: Date) => d.toISOString().slice(0, 16)

    // A request waiting on a Postgres advisory lock (an online refund's
    // per-payment lock held by another request).
    const waitForAdvisoryWaiter = async () => {
        for (let i = 0; i < 100; i++) {
            const [row] = await ctx.prisma.$queryRaw<Array<{ n: number }>>`
                SELECT count(*)::int AS n FROM pg_stat_activity
                WHERE datname = current_database() AND wait_event_type = 'Lock' AND wait_event = 'advisory'`
            if (row.n > 0) return
            await sleep(50)
        }
        throw new Error('no request waited on the payment lock')
    }

    const club = async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const ownerActor = await signIn(ctx, owner.email as string)
        const { user: admin } = await addMember(ctx, { workspaceId: workspace.id, role: RolesEnum.ADMIN })
        const { user: headCoach } = await addMember(ctx, { workspaceId: workspace.id, role: RolesEnum.HEAD_COACH })
        const plan = await createPlan(ctx, {
            workspaceId: workspace.id,
            name: 'БЖЖ 12',
            price: 4000,
            classCount: null,
            durationDays: 30,
        })
        const { user: student } = await addMember(ctx, { workspaceId: workspace.id })
        return {
            workspace,
            owner,
            ownerActor,
            admin,
            adminActor: await signIn(ctx, admin.email as string),
            headCoachActor: await signIn(ctx, headCoach.email as string),
            plan,
            student,
            studentActor: await signIn(ctx, student.email as string),
        }
    }
    type Club = Awaited<ReturnType<typeof club>>

    const refund = (c: Club, actor: Actor, body: Record<string, unknown>) =>
        ctx.http().post(`/workspaces/${c.workspace.id}/refunds`).set(...actor.auth).send(body)

    const money = async (c: Club) => {
        const [stats, plan] = await Promise.all([
            ctx.http().get(`/workspaces/${c.workspace.id}/stats`).set(...c.ownerActor.auth).expect(200),
            ctx.http().get(`/workspaces/${c.workspace.id}/plans/${c.plan.id}`).set(...c.ownerActor.auth).expect(200),
        ])
        return {
            revenue30d: stats.body.revenue.revenue30d as number,
            mrr: stats.body.revenue.mrr as number,
            plan30d: plan.body.last30Days.revenue as number,
        }
    }

    const journal = (c: Club, query: Record<string, string> = {}) =>
        ctx.http().get(`/workspaces/${c.workspace.id}/payment-journal`).query(query).set(...c.ownerActor.auth).expect(200)

    const sellCash = async (c: Club) => {
        const sold = await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/members/${c.student.id}/subscription`)
            .set(...c.adminActor.auth)
            .send({ planId: c.plan.id, paid: true, paymentMethod: 'CASH' })
            .expect(201)
        return sold.body.subscription.id as string
    }

    it('a partial cash refund nets out of revenue, mrr, the tariff page and the CSV; deleting the record restores them', async () => {
        const c = await club()
        const subId = await sellCash(c)
        const before = await money(c)
        expect(before.revenue30d).toBe(4000)
        expect(before.plan30d).toBe(4000)

        // Below club admin: refused.
        await refund(c, c.headCoachActor, {
            target: 'abonement', targetId: subId, amount: 1000, method: 'CASH', reason: 'Болел',
        }).expect(403)
        // More than was paid: refused, nothing recorded.
        const over = await refund(c, c.adminActor, {
            target: 'abonement', targetId: subId, amount: 4001, method: 'CASH', reason: 'Болел',
        }).expect(400)
        expect(over.body.message).toMatch(/Вернуть можно от 1 до 4\s000 ₽/)
        // No online payment behind a cash sale.
        const notOnline = await refund(c, c.adminActor, {
            target: 'abonement', targetId: subId, amount: 1000, method: 'ONLINE', reason: 'Болел',
        }).expect(400)
        expect(notOnline.body.message).toBe('Эту оплату принимали не онлайн — выберите, как вернули деньги')

        const done = await refund(c, c.adminActor, {
            target: 'abonement', targetId: subId, amount: 1000, method: 'CASH', reason: 'Пропустил две недели',
        }).expect(201)
        expect(done.body.refund).toMatchObject({
            kind: 'refund',
            source: 'abonement',
            amount: 1000,
            method: 'CASH',
            reason: 'Пропустил две недели',
            markedBy: { userId: c.admin.id },
            refundOf: { id: `sub:${subId}`, amount: 4000 },
        })
        expect(done.body.sale).toMatchObject({
            id: `sub:${subId}`,
            refundedAmount: 1000,
            refundable: 3000,
            refunds: [{ id: done.body.refund.id }],
        })
        const refundId = (done.body.refund.id as string).replace('ref:', '')

        const after = await money(c)
        expect(after.revenue30d).toBe(before.revenue30d - 1000)
        expect(after.plan30d).toBe(before.plan30d - 1000)
        // mrr counts the abonement net of its refunds over its 30 days.
        expect(after.mrr).toBe(before.mrr - 1000)

        // The journal: a −1 000 row, the payment shows what went back, «Итого» = revenue.
        const list = await journal(c)
        expect(list.body.data.map((e: { id: string }) => e.id)).toEqual([`ref:${refundId}`, `sub:${subId}`])
        expect(list.body.data[1]).toMatchObject({ refundedAmount: 1000, refundable: 3000 })
        expect(list.body.totals).toEqual([
            {
                currency: 'RUB',
                received: 4000,
                refunded: 1000,
                net: 3000,
                byMethod: [{ method: 'CASH', received: 4000, refunded: 1000, count: 1 }],
                // Sold at the tariff price: no discount; a refund never makes one.
                discounted: { count: 0, amount: 0, oneOffAmount: 0 },
            },
        ])
        expect(list.body.totals[0].net).toBe(after.revenue30d)
        const onlyRefunds = await journal(c, { kind: 'refund' })
        expect(onlyRefunds.body).toMatchObject({ total: 1, totals: [{ received: 0, refunded: 1000, net: -1000 }] })
        const onlyPayments = await journal(c, { kind: 'payment' })
        expect(onlyPayments.body.total).toBe(1)
        const csv = await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/exports/payments.csv`)
            .set(...c.ownerActor.auth)
            .expect(200)
        const rows = csv.text.split(/\r?\n/).slice(1).filter(Boolean)
        // Вид, Сумма and «Причина возврата» (the 14th column, after the discount ones).
        expect(rows.map((r) => r.split(';').slice(1, 2).concat(r.split(';')[5], r.split(';')[13]))).toEqual([
            ['Возврат', '-1000', 'Пропустил две недели'],
            ['Оплата', '4000', ''],
        ])

        // The member sees it on their abonement and got a push.
        const mine = await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/me/subscription`)
            .set(...c.studentActor.auth)
            .expect(200)
        expect(mine.body.abonements).toEqual([expect.objectContaining({ id: subId, amountPaid: 4000, refundedAmount: 1000 })])
        const notices = await ctx.prisma.notification.findMany({ where: { userId: c.student.id } })
        const pushed = notices.filter((n) => (n.metadata as { kind?: string } | null)?.kind === 'payment.refunded')
        expect(pushed).toHaveLength(1)
        expect(pushed[0].metadata).toMatchObject({ subscriptionId: subId, amount: 1000 })
        expect(pushed[0].message).toMatch(/вернул 1\s000 ₽ за «БЖЖ 12» — наличными/)
        expect(
            await ctx.prisma.auditEvent.count({ where: { workspaceId: c.workspace.id, action: 'payment.refund' } }),
        ).toBe(1)

        // A refunded sale can't be unmarked: the refund record goes first.
        const unmark = await ctx
            .http()
            .delete(`/workspaces/${c.workspace.id}/members/${c.student.id}/subscriptions/${subId}/payment`)
            .set(...c.ownerActor.auth)
            .expect(400)
        expect(unmark.body.message).toBe('По этой оплате есть возврат — сначала удалите запись о возврате')

        // Deleting the offline record restores every number.
        await ctx.http().delete(`/workspaces/${c.workspace.id}/refunds/${refundId}`).set(...c.headCoachActor.auth).expect(403)
        await ctx
            .http()
            .delete(`/workspaces/${c.workspace.id}/refunds/${refundId}`)
            .set(...c.ownerActor.auth)
            .expect(200)
            .expect({ status: 'deleted' })
        expect(await money(c)).toEqual(before)
        expect((await journal(c)).body.data.map((e: { id: string }) => e.id)).toEqual([`sub:${subId}`])
        expect(
            await ctx.prisma.auditEvent.count({ where: { workspaceId: c.workspace.id, action: 'payment.refundDelete' } }),
        ).toBe(1)
        // Now a mistaken mark may be taken back again.
        await ctx
            .http()
            .delete(`/workspaces/${c.workspace.id}/members/${c.student.id}/subscriptions/${subId}/payment`)
            .set(...c.ownerActor.auth)
            .expect(200)
    })

    const sellOnline = async (c: Club) => {
        await ctx
            .http()
            .put(`/workspaces/${c.workspace.id}/payment-settings`)
            .set(...c.ownerActor.auth)
            .send({ provider: 'YOOKASSA', shopId: '123456', secretKey: 'live_secret_0001' })
            .expect(200)
        await ctx
            .http()
            .patch(`/workspaces/${c.workspace.id}/plans/${c.plan.id}`)
            .set(...c.ownerActor.auth)
            .send({ purchasableOnline: true })
            .expect(200)
        const created = await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/payments`)
            .set(...c.studentActor.auth)
            .send({ planId: c.plan.id })
            .expect(201)
        gateway.setStatus('yk_1', 'SUCCEEDED')
        await ctx
            .http()
            .post(`/payments/webhooks/yookassa/${c.workspace.id}`)
            .send({ type: 'notification', event: 'payment.succeeded', object: { id: 'yk_1' } })
            .expect(200)
        const paymentId = created.body.payment.id as string
        const payment = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })
        return { paymentId, subId: payment.subscriptionId as string }
    }

    it('online: a part with a receipt, a double submit records one refund, the rest sets REFUNDED', async () => {
        const c = await club()
        const { paymentId, subId } = await sellOnline(c)
        // The receipt e-mail was stored with the payment.
        expect(await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).toMatchObject({
            receiptEmail: c.student.email,
        })
        const before = await money(c)

        // Two clicks at once (even with different amounts): the first holds the
        // payment's lock while at the provider; the second, which read the same
        // state, waits on it, then finds the payment moved → 409, never reaching
        // the provider.
        const body = { target: 'abonement', targetId: subId, amount: 1000, method: 'ONLINE', reason: 'Частично' }
        const pause = gateway.pauseRefunds()
        const first = refund(c, c.ownerActor, body).then((r) => r)
        await pause.reached
        const second = refund(c, c.adminActor, { ...body, amount: 500 }).then((r) => r)
        await waitForAdvisoryWaiter()
        pause.release()
        const [won, lost] = await Promise.all([first, second])
        expect(won.status).toBe(201)
        expect(lost.status).toBe(409)
        expect(lost.body.message).toBe('Возврат по этой оплате уже записан — обновите страницу')
        expect(gateway.refundRequests.map((r) => r.idempotenceKey)).toEqual([`refund-${paymentId}-0-1000`])
        // A part: the 54-ФЗ receipt for the refunded amount, to the payment's e-mail.
        expect(gateway.refundRequests[0]).toMatchObject({
            amount: 1000,
            receipt: { customerEmail: c.student.email, itemName: 'БЖЖ 12' },
        })
        expect(await ctx.prisma.refund.count({ where: { subscriptionId: subId } })).toBe(1)
        expect(await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).toMatchObject({
            status: 'SUCCEEDED',
            refundedAmount: 1000,
        })
        expect((await money(c)).revenue30d).toBe(before.revenue30d - 1000)

        // An online refund is final.
        const online = await ctx.prisma.refund.findFirstOrThrow({ where: { subscriptionId: subId } })
        const final = await ctx
            .http()
            .delete(`/workspaces/${c.workspace.id}/refunds/${online.id}`)
            .set(...c.ownerActor.auth)
            .expect(400)
        expect(final.body.message).toBe('Онлайн-возврат отменить нельзя — деньги уже ушли')

        // The rest: a new step (new key), the payment turns REFUNDED.
        const rest = await refund(c, c.ownerActor, { ...body, amount: 3000, reason: 'Остаток' }).expect(201)
        expect(rest.body.sale).toMatchObject({ refundedAmount: 4000, refundable: 0, online: { status: 'REFUNDED', refundable: 0 } })
        expect(gateway.refundRequests.at(-1)).toMatchObject({ idempotenceKey: `refund-${paymentId}-1000-3000`, amount: 3000 })
        expect((await money(c)).revenue30d).toBe(before.revenue30d - 4000)
        // A fully refunded abonement adds nothing to mrr; it stays active.
        expect((await money(c)).mrr).toBe(before.mrr - 4000)
        expect(await ctx.prisma.subscription.findUniqueOrThrow({ where: { id: subId } })).toMatchObject({
            status: 'ACTIVE',
            isPaid: true,
            refundedAmount: 4000,
        })
        // Online sales are never unmarked.
        await ctx
            .http()
            .delete(`/workspaces/${c.workspace.id}/members/${c.student.id}/subscriptions/${subId}/payment`)
            .set(...c.ownerActor.auth)
            .expect(400)
    })

    it('a full refund of an upcoming ticket frees the place to the waitlist; the paid row stays in the journal', async () => {
        const c = await club()
        const start = new Date(Date.now() + 2 * 24 * HOUR_MS)
        const event = await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/events`)
            .set(...c.ownerActor.auth)
            .send({
                title: 'Семинар по гвардам',
                startAt: wall(start),
                endAt: wall(new Date(start.getTime() + 2 * HOUR_MS)),
                timezone: 'UTC',
                price: 1500,
                capacity: 1,
            })
            .expect(201)
        const { user: next } = await addMember(ctx, { workspaceId: c.workspace.id })
        const nextActor = await signIn(ctx, next.email as string)
        const reg = await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/events/${event.body.id}/registrations`)
            .set(...c.studentActor.auth)
            .expect(201)
        const waiting = await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/events/${event.body.id}/registrations`)
            .set(...nextActor.auth)
            .expect(201)
        expect(waiting.body.status).toBe('WAITLISTED')
        await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/event-registrations/${reg.body.id}/payment`)
            .set(...c.ownerActor.auth)
            .send({ method: 'CASH' })
            .expect(201)

        // The panel says a full refund cancels the place.
        const entry = await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/payment-journal/${encodeURIComponent(`reg:${reg.body.id}`)}`)
            .set(...c.ownerActor.auth)
            .expect(200)
        expect(entry.body).toMatchObject({ refundable: 1500, fullRefundCancelsRegistration: true })

        // A part keeps the place.
        await refund(c, c.ownerActor, {
            target: 'ticket', targetId: reg.body.id, amount: 500, method: 'CASH', reason: 'Опоздал на час',
        }).expect(201)
        expect(await ctx.prisma.eventRegistration.findUniqueOrThrow({ where: { id: reg.body.id } })).toMatchObject({
            status: 'BOOKED',
            refundedAmount: 500,
        })
        // The rest completes it: cancelled, the place goes to the waitlist.
        await refund(c, c.ownerActor, {
            target: 'ticket', targetId: reg.body.id, amount: 1000, method: 'CASH', reason: 'Не сможет прийти',
        }).expect(201)
        expect(await ctx.prisma.eventRegistration.findUniqueOrThrow({ where: { id: reg.body.id } })).toMatchObject({
            status: 'CANCELLED',
            isPaid: true,
            refundedAmount: 1500,
        })
        expect(await ctx.prisma.eventRegistration.findUniqueOrThrow({ where: { id: waiting.body.id } })).toMatchObject({
            status: 'BOOKED',
        })
        const list = await journal(c)
        expect(list.body.data.map((e: { kind: string }) => e.kind)).toEqual(['refund', 'refund', 'payment'])
        expect(list.body.data[2]).toMatchObject({ id: `reg:${reg.body.id}`, refundedAmount: 1500, refundable: 0 })
        expect(list.body.totals[0]).toMatchObject({ received: 1500, refunded: 1500, net: 0 })
        // «Записавшиеся»: what the club keeps from paid tickets.
        const registrants = await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/events/${event.body.id}/registrations`)
            .set(...c.ownerActor.auth)
            .expect(200)
        expect(registrants.body.paid).toEqual({ count: 1, amount: 0 })
        expect(
            registrants.body.data.find((r: { id: string }) => r.id === reg.body.id),
        ).toMatchObject({ refundedAmount: 1500, isPaid: true })
        // The holder was told; the one who moved up too.
        const told = await ctx.prisma.notification.findMany({ where: { userId: c.student.id } })
        expect(told.map((n) => n.message)).toContainEqual(expect.stringMatching(/отменил вашу запись на «Семинар по гвардам»/))
        const promoted = await ctx.prisma.notification.findMany({ where: { userId: next.id } })
        expect(promoted.map((n) => n.topic)).toContain('Освободилось место')
        // A refunded ticket can't be unmarked.
        await ctx
            .http()
            .delete(`/workspaces/${c.workspace.id}/event-registrations/${reg.body.id}/payment`)
            .set(...c.ownerActor.auth)
            .expect(400)
    })
})
