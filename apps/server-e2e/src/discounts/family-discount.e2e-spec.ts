import { type Actor, signIn } from '../support/actors'
import { FakeGateway } from '../support/fake-payment-gateway'
import { addMember, createPlan, createUser, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// The family discount (docs/design/2026-11-15-discounts.md §3.1): a member
// qualifies when a relative one or two confirmed guardianship steps away holds
// a current abonement of the club. At a staff sale it is preselected, never
// applied by itself; the member's own online checkout applies it.
describe('discounts: the family discount', () => {
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
        ctx.mail.clear()
        gateway.reset()
    })

    // A guardian with two confirmed children and one child whose link the
    // club proposed but the guardian never confirmed — all members.
    const setup = async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const { user: guardian } = await addMember(ctx, { workspaceId: workspace.id })
        const kids = await Promise.all(
            ['Миша', 'Маша', 'Петя'].map(async (firstname) => {
                const kid = await createUser(ctx, { firstname })
                await addMember(ctx, { workspaceId: workspace.id, userId: kid.id })
                return kid
            }),
        )
        const [kid1, kid2, kid3] = kids
        await ctx.prisma.guardianship.createMany({
            data: [
                { guardianId: guardian.id, dependentId: kid1.id, consentAt: new Date() },
                { guardianId: guardian.id, dependentId: kid2.id, consentAt: new Date() },
                { guardianId: guardian.id, dependentId: kid3.id, consentAt: null },
            ],
        })
        const plan = await createPlan(ctx, {
            workspaceId: workspace.id,
            name: 'Безлимит',
            price: 4000,
            classCount: null,
        })
        const ownerActor = await signIn(ctx, owner.email)
        const family = await ctx
            .http()
            .post(`/workspaces/${workspace.id}/discounts`)
            .set(...ownerActor.auth)
            .send({ name: 'Семейная', kind: 'PERCENT', value: 10, isFamily: true })
        expect(family.status).toBe(201)
        return { workspace, guardian, kid1, kid2, kid3, plan, ownerActor, familyId: family.body.id as string }
    }

    const options = (actor: Actor, workspaceId: string, userId: string) =>
        ctx.http().get(`/workspaces/${workspaceId}/members/${userId}/sale-discounts`).set(...actor.auth)
    const sell = (actor: Actor, workspaceId: string, userId: string, body: Record<string, unknown>) =>
        ctx.http().post(`/workspaces/${workspaceId}/members/${userId}/subscription`).set(...actor.auth).send(body)

    it('the second child of one guardian gets «Семейная»; the first does not; an unconfirmed link does not count', async () => {
        const s = await setup()

        // Nobody in the family holds an abonement yet.
        const before = await options(s.ownerActor, s.workspace.id, s.kid2.id)
        expect(before.body).toEqual({ familyEligible: false, options: [] })

        // The first child buys at the full price (the server applies nothing by itself).
        const first = await sell(s.ownerActor, s.workspace.id, s.kid1.id, { planId: s.plan.id, paid: false })
        expect(first.body.subscription).toMatchObject({ amountPaid: 4000, discountId: null })

        const second = await options(s.ownerActor, s.workspace.id, s.kid2.id)
        expect(second.body.familyEligible).toBe(true)
        expect(second.body.options).toEqual([
            {
                discountId: s.familyId,
                name: 'Семейная',
                kind: 'PERCENT',
                value: 10,
                code: null,
                isFamily: true,
                endsOn: null,
                items: [{ planId: s.plan.id, eventId: null, listPrice: 4000, amount: 3600, currency: 'RUB' }],
            },
        ])
        // The first child's own relatives hold nothing (only kid1 does).
        expect((await options(s.ownerActor, s.workspace.id, s.kid1.id)).body.familyEligible).toBe(false)
        // An unconfirmed guardianship doesn't make a family.
        expect((await options(s.ownerActor, s.workspace.id, s.kid3.id)).body.familyEligible).toBe(false)

        const sold = await sell(s.ownerActor, s.workspace.id, s.kid2.id, { planId: s.plan.id, discountId: s.familyId })
        expect(sold.status).toBe(201)
        expect(sold.body.subscription).toMatchObject({
            amountPaid: 3600,
            listPrice: 4000,
            discountName: 'Семейная',
            discountAmount: 400,
        })
        const refused = await sell(s.ownerActor, s.workspace.id, s.kid3.id, { planId: s.plan.id, discountId: s.familyId })
        expect(refused.status).toBe(400)
        expect(refused.body.message).toBe('Семейная скидка — только если у члена семьи есть действующий абонемент')
    })

    it('the guardian’s own online checkout is priced with the family discount and the abonement carries it', async () => {
        const s = await setup()
        await sell(s.ownerActor, s.workspace.id, s.kid1.id, { planId: s.plan.id })
        await ctx
            .http()
            .put(`/workspaces/${s.workspace.id}/payment-settings`)
            .set(...s.ownerActor.auth)
            .send({ provider: 'YOOKASSA', shopId: '123456', secretKey: 'live_secret_0001' })
            .expect(200)
        await ctx
            .http()
            .patch(`/workspaces/${s.workspace.id}/plans/${s.plan.id}`)
            .set(...s.ownerActor.auth)
            .send({ purchasableOnline: true })
            .expect(200)
        const guardian = await signIn(ctx, s.guardian.email as string)

        const offer = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/me/online-purchase`)
            .set(...guardian.auth)
        expect(offer.body.plans[0]).toMatchObject({ id: s.plan.id, price: 4000, amount: 3600, discountName: 'Семейная' })

        const created = await ctx
            .http()
            .post(`/workspaces/${s.workspace.id}/payments`)
            .set(...guardian.auth)
            .send({ planId: s.plan.id })
        expect(created.status).toBe(201)
        expect(gateway.created[0].input).toMatchObject({ amount: 3600, currency: 'RUB' })

        const providerId = gateway.created[0].input.paymentId
        const payment = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: providerId } })
        expect(payment).toMatchObject({ amount: 3600, listPrice: 4000, discountId: s.familyId, discountAmount: 400 })

        gateway.setStatus(payment.providerPaymentId as string, 'SUCCEEDED')
        await ctx
            .http()
            .post(`/payments/webhooks/yookassa/${s.workspace.id}`)
            .send({ object: { id: payment.providerPaymentId } })
            .expect(200)
        const granted = await ctx.prisma.subscription.findFirstOrThrow({
            where: { workspaceId: s.workspace.id, userId: s.guardian.id, source: 'GATEWAY' },
        })
        expect(granted).toMatchObject({
            amountPaid: 3600,
            listPrice: 4000,
            discountId: s.familyId,
            discountName: 'Семейная',
            discountAmount: 400,
            pricedById: null,
        })
    })
})
