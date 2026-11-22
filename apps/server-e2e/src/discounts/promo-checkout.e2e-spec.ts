import { buildYookassaReceipt, formatYookassaAmount } from '../../../server/src/domains/payments/yookassa-api'
import { type Actor, signIn } from '../support/actors'
import { FakeGateway } from '../support/fake-payment-gateway'
import { addMember, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const HOUR_MS = 3600_000
const DAY_MS = 24 * HOUR_MS

// A promo code in the member's app (docs/design/2026-11-15-discounts.md §3.3,
// §3.6): the quote shows the price, the checkout charges exactly it (or
// refuses with the quote's note), the YooKassa receipt line is the charged
// price, and the webhook records the discount on the sale.
describe('promo code checkout', () => {
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

    const club = async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const ownerActor = await signIn(ctx, owner.email as string)
        const { user } = await addMember(ctx, { workspaceId: workspace.id })
        const memberActor = await signIn(ctx, user.email as string)
        const plan = await createPlan(ctx, {
            workspaceId: workspace.id,
            name: 'Безлимит',
            price: 4500,
            classCount: null,
            durationDays: 30,
        })
        const other = await createPlan(ctx, { workspaceId: workspace.id, name: '8 занятий', price: 4000 })
        await ctx
            .http()
            .put(`/workspaces/${workspace.id}/payment-settings`)
            .set(...ownerActor.auth)
            .send({ provider: 'YOOKASSA', shopId: '123456', secretKey: 'live_secret_0001' })
            .expect(200)
        for (const p of [plan, other]) {
            await ctx
                .http()
                .patch(`/workspaces/${workspace.id}/plans/${p.id}`)
                .set(...ownerActor.auth)
                .send({ purchasableOnline: true })
                .expect(200)
        }
        return { workspace, ownerActor, member: user, memberActor, plan, other }
    }
    type Club = Awaited<ReturnType<typeof club>>

    const createDiscount = (c: Club, body: Record<string, unknown>) =>
        ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/discounts`)
            .set(...c.ownerActor.auth)
            .send({ kind: 'PERCENT', ...body })
            .expect(201)
            .then((r) => r.body as { id: string })

    const quote = (c: Club, a: Actor, query: Record<string, string>) =>
        ctx.http().get(`/workspaces/${c.workspace.id}/me/checkout-quote`).query(query).set(...a.auth)

    const buy = (c: Club, body: Record<string, unknown>) =>
        ctx.http().post(`/workspaces/${c.workspace.id}/payments`).set(...c.memberActor.auth).send(body)

    const succeed = async (c: Club, providerPaymentId: string) => {
        gateway.setStatus(providerPaymentId, 'SUCCEEDED')
        await ctx
            .http()
            .post(`/payments/webhooks/yookassa/${c.workspace.id}`)
            .send({ type: 'notification', event: 'payment.succeeded', object: { id: providerPaymentId } })
            .expect(200)
    }

    it('quote → checkout → webhook: the discounted price is charged, receipted and recorded; a second use is refused', async () => {
        const c = await club()
        await createDiscount(c, { name: 'Весна', value: 10, code: 'ВЕСНА', oncePerMember: true })

        const before = await quote(c, c.memberActor, { planId: c.plan.id }).expect(200)
        expect(before.body).toEqual({ listPrice: 4500, amount: 4500, currency: 'RUB', discount: null, promoCodeNote: null })
        const q = await quote(c, c.memberActor, { planId: c.plan.id, promoCode: ' весна ' }).expect(200)
        expect(q.body).toEqual({
            listPrice: 4500,
            amount: 4050,
            currency: 'RUB',
            discount: { name: 'Весна', code: 'ВЕСНА', isFamily: false, endsOn: null },
            promoCodeNote: null,
        })

        const created = await buy(c, { planId: c.plan.id, promoCode: 'весна' }).expect(201)
        expect(created.body.payment.amount).toBe(q.body.amount)
        expect(gateway.created).toHaveLength(1)
        const input = gateway.created[0].input
        expect(input.amount).toBe(4050)
        // The 54-ФЗ receipt: one line, the charged (discounted) price, no discount line.
        const receipt = buildYookassaReceipt(input, {
            enabled: true,
            vatCode: 1,
            paymentSubject: 'service',
            paymentMode: 'full_prepayment',
        })
        expect(receipt.items).toHaveLength(1)
        expect(receipt.items[0].amount.value).toBe(formatYookassaAmount(4050))
        expect(receipt.items[0].description).toBe('Абонемент «Безлимит»')
        // A double tap with the same code reuses it (its own use doesn't count).
        const again = await buy(c, { planId: c.plan.id, promoCode: 'ВЕСНА' }).expect(201)
        expect(again.body.payment.id).toBe(created.body.payment.id)
        expect(gateway.created).toHaveLength(1)

        await succeed(c, 'yk_1')
        const sub = await ctx.prisma.subscription.findFirstOrThrow({
            where: { workspaceId: c.workspace.id, source: 'GATEWAY' },
        })
        expect(sub).toMatchObject({
            amountPaid: 4050,
            listPrice: 4500,
            discountName: 'Весна',
            discountAmount: 450,
            pricedById: null,
            paymentMethod: 'ONLINE',
        })
        const journal = await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/payment-journal`)
            .set(...c.ownerActor.auth)
            .expect(200)
        expect(journal.body.data[0]).toMatchObject({
            amount: 4050,
            listPrice: 4500,
            discountName: 'Весна',
            discountAmount: 450,
            oneOffDiscount: 0,
            pricedBy: null,
        })
        expect(journal.body.totals[0]).toMatchObject({ net: 4050, discounted: { count: 1, amount: 450, oneOffAmount: 0 } })

        // Once per member: noted by the quote, refused by the checkout.
        const used = await quote(c, c.memberActor, { planId: c.other.id, promoCode: 'ВЕСНА' }).expect(200)
        expect(used.body).toMatchObject({ amount: 4000, discount: null, promoCodeNote: 'Вы уже использовали этот промокод' })
        const refused = await buy(c, { planId: c.other.id, promoCode: 'ВЕСНА' }).expect(400)
        expect(refused.body.message).toBe('Вы уже использовали этот промокод')
        expect(gateway.created).toHaveLength(1)
    })

    it('expired, wrong-tariff, unknown, archived and 0 ₽ codes: a note in the quote, a 400 at checkout', async () => {
        const c = await club()
        const expired = await createDiscount(c, { name: 'Осень', value: 10, code: 'ОСЕНЬ' })
        const yesterday = new Date(Date.now() - DAY_MS).toISOString().slice(0, 10)
        await ctx.prisma.discount.update({
            where: { id: expired.id },
            data: { startsOn: new Date(`${yesterday}T00:00:00Z`), endsOn: new Date(`${yesterday}T00:00:00Z`) },
        })
        await createDiscount(c, { name: 'Только восьмёрка', value: 10, code: 'ВОСЕМЬ', allPlans: false, planIds: [c.other.id] })
        await createDiscount(c, { name: 'Даром', value: 100, code: 'ДАРОМ' })
        const archived = await createDiscount(c, { name: 'Старый', value: 10, code: 'СТАРЫЙ' })
        await ctx
            .http()
            .patch(`/workspaces/${c.workspace.id}/discounts/${archived.id}`)
            .set(...c.ownerActor.auth)
            .send({ isActive: false })
            .expect(200)

        const cases: Array<[string, string]> = [
            ['ОСЕНЬ', 'Срок действия промокода закончился'],
            ['ВОСЕМЬ', 'Промокод не действует на этот тариф'],
            ['НЕБЫЛО', 'Промокод не найден'],
            ['СТАРЫЙ', 'Промокод не найден'],
            ['ДАРОМ', 'С промокодом выходит 0 ₽ — оформите покупку в клубе'],
        ]
        for (const [code, note] of cases) {
            const q = await quote(c, c.memberActor, { planId: c.plan.id, promoCode: code }).expect(200)
            expect(q.body).toMatchObject({ amount: 4500, discount: null, promoCodeNote: note })
            const res = await buy(c, { planId: c.plan.id, promoCode: code }).expect(400)
            expect(res.body.message).toBe(note)
        }
        expect(gateway.created).toHaveLength(0)
        // The wrong-tariff code does apply to its own tariff.
        const own = await quote(c, c.memberActor, { planId: c.other.id, promoCode: 'восемь' }).expect(200)
        expect(own.body).toMatchObject({ amount: 3600, promoCodeNote: null })
        // Exactly one of a tariff or a ticket.
        await quote(c, c.memberActor, {}).expect(400)
    })

    it('a ticket checkout with a code: quoted, charged and recorded on the registration', async () => {
        const c = await club()
        await createDiscount(c, { name: 'Семинары', value: 20, code: 'СЕМИНАР', allPlans: false, events: true })
        const start = new Date(Date.now() + 2 * DAY_MS)
        const event = await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/events`)
            .set(...c.ownerActor.auth)
            .send({
                title: 'Семинар по гвардам',
                startAt: start.toISOString().slice(0, 16),
                endAt: new Date(start.getTime() + 2 * HOUR_MS).toISOString().slice(0, 16),
                timezone: 'UTC',
                price: 1500,
            })
            .expect(201)
        const reg = await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/events/${event.body.id}/registrations`)
            .set(...c.memberActor.auth)
            .expect(201)

        const q = await quote(c, c.memberActor, { registrationId: reg.body.id, promoCode: 'семинар' }).expect(200)
        expect(q.body).toMatchObject({ listPrice: 1500, amount: 1200, discount: { name: 'Семинары' } })
        // Not on a tariff: the code is scoped to events.
        const onTariff = await quote(c, c.memberActor, { planId: c.plan.id, promoCode: 'СЕМИНАР' }).expect(200)
        expect(onTariff.body.promoCodeNote).toBe('Промокод не действует на этот тариф')

        const checkout = await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/event-registrations/${reg.body.id}/checkout`)
            .set(...c.memberActor.auth)
            .send({ promoCode: 'СЕМИНАР' })
            .expect(201)
        expect(checkout.body.payment.amount).toBe(1200)
        expect(gateway.created[0].input).toMatchObject({ amount: 1200, itemName: 'Билет «Семинар по гвардам»' })
        await succeed(c, 'yk_1')
        const row = await ctx.prisma.eventRegistration.findUniqueOrThrow({ where: { id: reg.body.id } })
        expect(row).toMatchObject({
            isPaid: true,
            amountPaid: 1200,
            listPrice: 1500,
            discountName: 'Семинары',
            discountAmount: 300,
            pricedById: null,
        })
    })
})
