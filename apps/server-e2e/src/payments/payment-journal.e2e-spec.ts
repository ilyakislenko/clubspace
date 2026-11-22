import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { type Actor, signIn } from '../support/actors'
import { FakeGateway } from '../support/fake-payment-gateway'
import { addMember, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const HOUR_MS = 3600_000

type Entry = {
    id: string
    source: 'abonement' | 'ticket'
    amount: number
    method: string | null
    member: { userId: string | null; name: string; isMember: boolean }
    markedBy: { userId: string; name: string } | null
    online: { paymentId: string } | null
}

// «Платежи» (docs/design/2026-11-15-payments-journal.md, phase A): one list
// of the club's sales — cash, transfer and online abonements and a ticket —
// whose default «Итого» is the dashboard's «Выручка за 30 дней», filtered by
// method and by who marked it, closed to the head coach, and the same rows
// as payments.csv.
describe('payments journal', () => {
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

    const club = async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const ownerActor = await signIn(ctx, owner.email as string)
        const { user: admin } = await addMember(ctx, { workspaceId: workspace.id, role: RolesEnum.ADMIN })
        const { user: headCoach } = await addMember(ctx, { workspaceId: workspace.id, role: RolesEnum.HEAD_COACH })
        const plan = await createPlan(ctx, {
            workspaceId: workspace.id,
            name: 'БЖЖ 12',
            price: 4500,
            classCount: null,
            durationDays: 30,
        })
        const members = await Promise.all([1, 2, 3].map(() => addMember(ctx, { workspaceId: workspace.id })))
        return {
            workspace,
            owner,
            ownerActor,
            admin,
            adminActor: await signIn(ctx, admin.email as string),
            headCoachActor: await signIn(ctx, headCoach.email as string),
            plan,
            members: members.map((m) => m.user),
        }
    }
    type Club = Awaited<ReturnType<typeof club>>

    const journal = (c: Club, actor: Actor, query: Record<string, string> = {}) =>
        ctx.http().get(`/workspaces/${c.workspace.id}/payment-journal`).query(query).set(...actor.auth)

    // Four sales: transfer sold as paid by the owner, cash marked by the
    // admin, an online checkout, a card-paid ticket.
    const sell = async (c: Club) => {
        const [a, b, online] = c.members
        const transfer = await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/members/${a.id}/subscription`)
            .set(...c.ownerActor.auth)
            .send({ planId: c.plan.id, amountPaid: 4000, paid: true, paymentMethod: 'TRANSFER' })
            .expect(201)

        const credit = await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/members/${b.id}/subscription`)
            .set(...c.ownerActor.auth)
            .send({ planId: c.plan.id, paid: false })
            .expect(201)
        await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/members/${b.id}/subscriptions/${credit.body.subscription.id}/payment`)
            .set(...c.adminActor.auth)
            .send({ amount: 3500, method: 'CASH' })
            .expect(201)

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
        const onlineActor = await signIn(ctx, online.email as string)
        const created = await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/payments`)
            .set(...onlineActor.auth)
            .send({ planId: c.plan.id })
            .expect(201)
        gateway.setStatus('yk_1', 'SUCCEEDED')
        await ctx
            .http()
            .post(`/payments/webhooks/yookassa/${c.workspace.id}`)
            .send({ type: 'notification', event: 'payment.succeeded', object: { id: 'yk_1' } })
            .expect(200)

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
            })
            .expect(201)
        const aActor = await signIn(ctx, a.email as string)
        const reg = await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/events/${event.body.id}/registrations`)
            .set(...aActor.auth)
            .expect(201)
        await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/event-registrations/${reg.body.id}/payment`)
            .set(...c.ownerActor.auth)
            .send({ method: 'CARD' })
            .expect(201)

        return {
            transferId: transfer.body.subscription.id as string,
            cashId: credit.body.subscription.id as string,
            paymentId: created.body.payment.id as string,
            registrationId: reg.body.id as string,
        }
    }

    it('lists every sale newest first; the default «Итого» is «Выручка за 30 дней»', async () => {
        const c = await club()
        const s = await sell(c)

        const res = await journal(c, c.ownerActor).expect(200)
        const data = res.body.data as Entry[]
        expect(res.body).toMatchObject({ total: 4, curPage: 1, perPage: 50 })
        expect(data.map((e) => e.id)).toEqual([
            `reg:${s.registrationId}`,
            expect.stringMatching(/^sub:/),
            `sub:${s.cashId}`,
            `sub:${s.transferId}`,
        ])
        expect(data[0]).toMatchObject({ source: 'ticket', amount: 1500, method: 'CARD', markedBy: { userId: c.owner.id } })
        expect(data[1]).toMatchObject({ method: 'ONLINE', amount: 4500, markedBy: null, online: { paymentId: s.paymentId } })
        expect(data[2]).toMatchObject({ method: 'CASH', amount: 3500, markedBy: { userId: c.admin.id } })
        expect(data[3]).toMatchObject({
            method: 'TRANSFER',
            amount: 4000,
            markedBy: { userId: c.owner.id },
            member: { userId: c.members[0].id, isMember: true },
        })

        expect(res.body.totals).toEqual([
            {
                currency: 'RUB',
                received: 13500,
                refunded: 0,
                net: 13500,
                byMethod: [
                    { method: 'CASH', received: 3500, refunded: 0, count: 1 },
                    { method: 'TRANSFER', received: 4000, refunded: 0, count: 1 },
                    { method: 'CARD', received: 1500, refunded: 0, count: 1 },
                    { method: 'ONLINE', received: 4500, refunded: 0, count: 1 },
                ],
            },
        ])
        expect(res.body.unapplied).toEqual({ total: 0, data: [] })

        const stats = await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/stats`)
            .set(...c.ownerActor.auth)
            .expect(200)
        expect(res.body.totals[0].net).toBe(stats.body.revenue.revenue30d)

        // The cash mark's audit names the abonement and the method.
        const audit = await ctx.prisma.auditEvent.findFirstOrThrow({
            where: { workspaceId: c.workspace.id, action: 'member.markSubscriptionPaid' },
        })
        expect(audit.actorId).toBe(c.admin.id)
        expect(audit.metadata).toMatchObject({ subscriptionId: s.cashId, method: 'CASH' })
    })

    it('method and «Отметил» narrow rows and totals together; one entry opens', async () => {
        const c = await club()
        const s = await sell(c)

        const cash = await journal(c, c.ownerActor, { method: 'CASH' }).expect(200)
        expect((cash.body.data as Entry[]).map((e) => e.id)).toEqual([`sub:${s.cashId}`])
        expect(cash.body.total).toBe(1)
        expect(cash.body.totals[0]).toMatchObject({ received: 3500, net: 3500 })

        const byAdmin = await journal(c, c.ownerActor, { markedById: c.admin.id }).expect(200)
        expect((byAdmin.body.data as Entry[]).map((e) => e.id)).toEqual([`sub:${s.cashId}`])

        const byOwner = await journal(c, c.ownerActor, { markedById: c.owner.id }).expect(200)
        expect(byOwner.body.total).toBe(2)
        expect(byOwner.body.totals[0].net).toBe(5500)

        const none = await journal(c, c.ownerActor, { method: 'NONE' }).expect(200)
        expect(none.body).toMatchObject({ total: 0, data: [], totals: [] })

        const found = await journal(c, c.ownerActor, { q: c.members[1].email as string }).expect(200)
        expect((found.body.data as Entry[]).map((e) => e.id)).toEqual([`sub:${s.cashId}`])

        const detail = await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/payment-journal/${encodeURIComponent(`sub:${s.cashId}`)}`)
            .set(...c.adminActor.auth)
            .expect(200)
        expect(detail.body).toMatchObject({
            id: `sub:${s.cashId}`,
            markedBy: { userId: c.admin.id },
            refunds: [],
            memberHasCard: true,
        })

        // A refused period and a foreign entry.
        await journal(c, c.ownerActor, { from: '2026-11-01' }).expect(400)
        await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/payment-journal/sub:00000000-0000-4000-8000-000000000000`)
            .set(...c.ownerActor.auth)
            .expect(404)
    })

    it('is closed to the head coach: list, entry and the CSV', async () => {
        const c = await club()
        const s = await sell(c)
        await journal(c, c.headCoachActor).expect(403)
        await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/payment-journal/sub:${s.cashId}`)
            .set(...c.headCoachActor.auth)
            .expect(403)
        await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/exports/payments.csv`)
            .set(...c.headCoachActor.auth)
            .expect(403)
    })

    it('payments.csv holds the rows of the same view, in the same order', async () => {
        const c = await club()
        await sell(c)
        const views: Record<string, string>[] = [{}, { method: 'CASH' }, { markedById: c.owner.id }]
        for (const query of views) {
            const list = await journal(c, c.ownerActor, query).expect(200)
            const csv = await ctx
                .http()
                .get(`/workspaces/${c.workspace.id}/exports/payments.csv`)
                .query(query)
                .set(...c.ownerActor.auth)
                .expect(200)
            const rows = csv.text.split(/\r?\n/).slice(1).filter(Boolean)
            expect(rows).toHaveLength(list.body.total)
            // Сумма is the 6th column, Источник the 11th.
            expect(rows.map((r) => r.split(';')[5])).toEqual(
                (list.body.data as Entry[]).map((e) => String(e.amount)),
            )
            expect(rows.map((r) => r.split(';')[10])).toEqual(
                (list.body.data as Entry[]).map((e) => (e.source === 'ticket' ? 'Событие' : 'Абонемент')),
            )
            expect(csv.headers['content-disposition']).toMatch(/filename="payments-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv"/)
        }
        expect(
            await ctx.prisma.auditEvent.count({ where: { workspaceId: c.workspace.id, action: 'export.payments' } }),
        ).toBe(3)
    })
})
