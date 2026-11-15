import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { type Actor, signIn } from '../support/actors'
import { addMember, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// Selling with a discount at the club (docs/design/2026-11-15-discounts.md
// §3.3): a club discount from the list, or a typed amount (today's rule) that
// is now recorded as a one-off discount with who set it — visible in the
// journal, its filters and «Кто давал скидки». Real Postgres for the row lock.
describe('discounts: staff sales', () => {
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

    const setup = async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const { user: headCoach } = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.HEAD_COACH,
        })
        await ctx.prisma.user.update({
            where: { id: headCoach.id },
            data: { firstname: 'Пётр', lastname: 'Петров' },
        })
        const { user: admin } = await addMember(ctx, { workspaceId: workspace.id, role: RolesEnum.ADMIN })
        await ctx.prisma.user.update({
            where: { id: admin.id },
            data: { firstname: 'Анна', lastname: 'Админова' },
        })
        const students = await Promise.all(
            [0, 1, 2, 3].map(async () => (await addMember(ctx, { workspaceId: workspace.id })).user),
        )
        const plan = await createPlan(ctx, {
            workspaceId: workspace.id,
            name: 'Безлимит',
            price: 4000,
            classCount: null,
        })
        const ownerActor = await signIn(ctx, owner.email)
        const headActor = await signIn(ctx, headCoach.email as string)
        const adminActor = await signIn(ctx, admin.email as string)
        return { workspace, headCoach, admin, students, plan, ownerActor, headActor, adminActor }
    }

    const createDiscount = async (actor: Actor, workspaceId: string, body: Record<string, unknown>) => {
        const res = await ctx.http().post(`/workspaces/${workspaceId}/discounts`).set(...actor.auth).send(body)
        expect(res.status).toBe(201)
        return res.body as { id: string }
    }
    const sell = (actor: Actor, workspaceId: string, userId: string, body: Record<string, unknown>) =>
        ctx.http().post(`/workspaces/${workspaceId}/members/${userId}/subscription`).set(...actor.auth).send(body)
    const journal = (actor: Actor, workspaceId: string, query: Record<string, string> = {}) =>
        ctx.http().get(`/workspaces/${workspaceId}/payment-journal`).query(query).set(...actor.auth)

    it('the head coach sells with «Студенческая −15%»: the amount, the list price and the journal row show it', async () => {
        const s = await setup()
        const d = await createDiscount(s.ownerActor, s.workspace.id, { name: 'Студенческая', kind: 'PERCENT', value: 15 })
        const [student] = s.students

        const options = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/members/${student.id}/sale-discounts`)
            .set(...s.headActor.auth)
        expect(options.body.options[0].items[0]).toMatchObject({ planId: s.plan.id, listPrice: 4000, amount: 3400 })

        const sold = await sell(s.headActor, s.workspace.id, student.id, {
            planId: s.plan.id,
            discountId: d.id,
            paymentMethod: 'CASH',
        })
        expect(sold.status).toBe(201)
        expect(sold.body.subscription).toMatchObject({
            amountPaid: 3400,
            listPrice: 4000,
            discountId: d.id,
            discountName: 'Студенческая',
            discountAmount: 600,
            oneOffDiscount: 0,
        })
        const row = await ctx.prisma.subscription.findUniqueOrThrow({ where: { id: sold.body.subscription.id } })
        expect(row.pricedById).toBe(s.headCoach.id)

        const j = await journal(s.ownerActor, s.workspace.id)
        expect(j.status).toBe(200)
        expect(j.body.data[0]).toMatchObject({
            amount: 3400,
            listPrice: 4000,
            discountName: 'Студенческая',
            discountAmount: 600,
            oneOffDiscount: 0,
        })
        const audit = await ctx.prisma.auditEvent.findFirstOrThrow({ where: { action: 'member.assignSubscription' } })
        expect(audit.actorId).toBe(s.headCoach.id)
        expect(audit.metadata).toMatchObject({ listPrice: 4000, discountName: 'Студенческая', discountAmount: 600 })
        expect(audit.metadata).not.toHaveProperty('oneOff')
    })

    it('a typed lower amount (cash part-payment) is accepted and shows as «Разовая скидка · <who>»; filters and «Кто давал скидки» find it', async () => {
        const s = await setup()
        const [a, b, c] = s.students

        const head = await sell(s.headActor, s.workspace.id, a.id, { planId: s.plan.id, amountPaid: 3000, paymentMethod: 'CASH' })
        expect(head.status).toBe(201)
        expect(head.body.subscription).toMatchObject({ amountPaid: 3000, listPrice: 4000, oneOffDiscount: 1000 })
        // The admin's one-off is recorded the same way.
        const admin = await sell(s.adminActor, s.workspace.id, b.id, { planId: s.plan.id, amountPaid: 3500 })
        expect(admin.status).toBe(201)
        // A sale at the price is no discount.
        expect((await sell(s.ownerActor, s.workspace.id, c.id, { planId: s.plan.id })).status).toBe(201)

        const all = await journal(s.ownerActor, s.workspace.id)
        const headRow = all.body.data.find((r: { subscriptionId: string }) => r.subscriptionId === head.body.subscription.id)
        expect(headRow).toMatchObject({
            listPrice: 4000,
            discountName: null,
            oneOffDiscount: 1000,
            pricedBy: { userId: s.headCoach.id, name: 'Пётр Петров' },
        })
        expect(all.body.totals[0].discounted).toEqual({ count: 2, amount: 1500, oneOffAmount: 1500 })

        const discounted = await journal(s.ownerActor, s.workspace.id, { discounted: 'true' })
        expect(discounted.body.data).toHaveLength(2)
        const byHead = await journal(s.ownerActor, s.workspace.id, { discounted: 'true', pricedById: s.headCoach.id })
        expect(byHead.body.data.map((r: { subscriptionId: string }) => r.subscriptionId)).toEqual([head.body.subscription.id])

        const discounts = await ctx.http().get(`/workspaces/${s.workspace.id}/discounts`).set(...s.ownerActor.auth)
        expect(discounts.status).toBe(200)
        expect(discounts.body.byStaff).toEqual([
            {
                userId: s.headCoach.id,
                name: 'Пётр Петров',
                currency: 'RUB',
                oneOff: { count: 1, amount: 1000 },
                named: { count: 0, amount: 0 },
            },
            {
                userId: s.admin.id,
                name: 'Анна Админова',
                currency: 'RUB',
                oneOff: { count: 1, amount: 500 },
                named: { count: 0, amount: 0 },
            },
        ])

        const audit = await ctx.prisma.auditEvent.findFirstOrThrow({
            where: { action: 'member.assignSubscription', actorId: s.headCoach.id },
        })
        expect(audit.metadata).toMatchObject({ listPrice: 4000, amount: 3000, oneOff: 1000 })
    })

    it('maxUses = 1, two staff sales at once: exactly one succeeds (row lock)', async () => {
        const s = await setup()
        const d = await createDiscount(s.ownerActor, s.workspace.id, { name: 'Акция', kind: 'PERCENT', value: 20, maxUses: 1 })
        const [a, b] = s.students
        const results = await Promise.all([
            sell(s.headActor, s.workspace.id, a.id, { planId: s.plan.id, discountId: d.id }),
            sell(s.adminActor, s.workspace.id, b.id, { planId: s.plan.id, discountId: d.id }),
        ])
        expect(results.map((r) => r.status).sort()).toEqual([201, 400])
        expect(results.find((r) => r.status === 400)?.body.message).toBe('Лимит скидки «Акция» исчерпан')
        expect(await ctx.prisma.subscription.count({ where: { discountId: d.id } })).toBe(1)
    })

    it('once per member, dates and scope are refused with the texts', async () => {
        const s = await setup()
        const [a] = s.students
        const once = await createDiscount(s.ownerActor, s.workspace.id, { name: 'Разовая акция', kind: 'PERCENT', value: 10, oncePerMember: true })
        const first = await sell(s.ownerActor, s.workspace.id, a.id, { planId: s.plan.id, discountId: once.id, paid: false })
        expect(first.status).toBe(201)
        // Cancelled unpaid: it never happened, so the use is given back.
        const cancelled = await ctx
            .http()
            .post(`/workspaces/${s.workspace.id}/members/${a.id}/subscriptions/${first.body.subscription.id}/cancel`)
            .set(...s.ownerActor.auth)
        expect(cancelled.status).toBe(201)
        const second = await sell(s.ownerActor, s.workspace.id, a.id, { planId: s.plan.id, discountId: once.id })
        expect(second.status).toBe(201)
        // Now used (paid): refused before anything else is checked.
        const again = await sell(s.ownerActor, s.workspace.id, a.id, { planId: s.plan.id, discountId: once.id })
        expect(again.status).toBe(400)
        expect(again.body.message).toBe('Скидка «Разовая акция» уже использована этим учеником')

        const later = await createDiscount(s.ownerActor, s.workspace.id, { name: 'Лето', kind: 'PERCENT', value: 10, startsOn: '2099-06-01' })
        const early = await sell(s.ownerActor, s.workspace.id, s.students[1].id, { planId: s.plan.id, discountId: later.id })
        expect(early.body.message).toBe('Срок скидки «Лето» ещё не начался')

        const other = await createPlan(ctx, { workspaceId: s.workspace.id, name: 'Другой', price: 2000 })
        const scoped = await createDiscount(s.ownerActor, s.workspace.id, { name: 'Только другой', kind: 'PERCENT', value: 10, allPlans: false, planIds: [other.id] })
        const wrong = await sell(s.ownerActor, s.workspace.id, s.students[1].id, { planId: s.plan.id, discountId: scoped.id })
        expect(wrong.body.message).toBe('Скидка «Только другой» не действует на этот тариф')
    })

    it('mark-paid applies a discount to a credit sale; a ticket takes a discount and a typed amount', async () => {
        const s = await setup()
        const d = await createDiscount(s.ownerActor, s.workspace.id, { name: 'Все', kind: 'FIXED', value: 500, currency: 'RUB', events: true })
        const [a, b] = s.students
        const credit = await sell(s.ownerActor, s.workspace.id, a.id, { planId: s.plan.id, paid: false })
        const paid = await ctx
            .http()
            .post(`/workspaces/${s.workspace.id}/members/${a.id}/subscriptions/${credit.body.subscription.id}/payment`)
            .set(...s.headActor.auth)
            .send({ discountId: d.id, method: 'CASH' })
        expect(paid.status).toBe(201)
        expect(paid.body.subscription).toMatchObject({ amountPaid: 3500, discountName: 'Все', discountAmount: 500, oneOffDiscount: 0 })
        expect(
            (await ctx.prisma.subscription.findUniqueOrThrow({ where: { id: credit.body.subscription.id } })).pricedById,
        ).toBe(s.headCoach.id)

        const event = await ctx.prisma.workspaceEvent.create({
            data: {
                workspaceId: s.workspace.id,
                title: 'Мастер-класс',
                startAt: new Date(Date.now() + 7 * 86_400_000),
                endAt: new Date(Date.now() + 7 * 86_400_000 + 2 * 3_600_000),
                timezone: 'Europe/Moscow',
                createdById: s.headCoach.id,
                price: 1500,
                currency: 'RUB',
            },
        })
        const reg = await ctx.prisma.eventRegistration.create({
            data: { workspaceId: s.workspace.id, eventId: event.id, userId: b.id, status: 'BOOKED', bookedById: b.id },
        })
        const ticketOptions = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/members/${b.id}/sale-discounts`)
            .query({ eventId: event.id })
            .set(...s.headActor.auth)
        expect(ticketOptions.body.options[0].items).toEqual([
            { planId: null, eventId: event.id, listPrice: 1500, amount: 1000, currency: 'RUB' },
        ])
        const marked = await ctx
            .http()
            .post(`/workspaces/${s.workspace.id}/event-registrations/${reg.id}/payment`)
            .set(...s.headActor.auth)
            .send({ method: 'CASH', discountId: d.id, amount: 900 })
        expect(marked.status).toBe(201)
        expect(marked.body).toMatchObject({
            amountPaid: 900,
            listPrice: 1500,
            discountName: 'Все',
            discountAmount: 500,
            oneOffDiscount: 100,
            pricedBy: { userId: s.headCoach.id, name: 'Пётр Петров' },
        })
    })
})
