import { signIn } from '../support/actors'
import { addMember, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// Payment marking: a sale can be recorded as unpaid, revenue counts paid rows
// only, and marking the payment moves the amount into revenue. Real Postgres
// because the paid-or-legacy date filter and the compare-and-set are exactly
// what a jest.fn() cannot prove.
describe('marking an abonement as paid', () => {
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
        const { user: memberUser } = await addMember(ctx, {
            workspaceId: workspace.id,
        })
        const plan = await createPlan(ctx, {
            workspaceId: workspace.id,
            durationDays: 30,
        })
        const ownerActor = await signIn(ctx, owner.email)
        const memberActor = await signIn(ctx, memberUser.email)
        return { workspace, ownerActor, memberUser, memberActor, plan }
    }

    const sellUnpaid = (
        auth: [string, string],
        workspaceId: string,
        userId: string,
        planId: string,
    ) =>
        ctx
            .http()
            .post(`/workspaces/${workspaceId}/members/${userId}/subscription`)
            .set(...auth)
            .send({ planId, amountPaid: 4500, paid: false })

    const pay = (
        auth: [string, string],
        workspaceId: string,
        userId: string,
        subscriptionId: string,
        body: Record<string, unknown> = {},
    ) =>
        ctx
            .http()
            .post(
                `/workspaces/${workspaceId}/members/${userId}/subscriptions/${subscriptionId}/payment`,
            )
            .set(...auth)
            .send(body)

    const stats = (auth: [string, string], workspaceId: string) =>
        ctx
            .http()
            .get(`/workspaces/${workspaceId}/stats`)
            .set(...auth)

    it('an unpaid sale is not revenue until the payment is marked', async () => {
        const { workspace, ownerActor, memberUser, plan } = await setup()

        const sold = await sellUnpaid(
            ownerActor.auth,
            workspace.id,
            memberUser.id,
            plan.id,
        )
        expect(sold.status).toBe(201)
        expect(sold.body.subscription).toMatchObject({
            isPaid: false,
            paidAt: null,
            amountPaid: 4500,
        })

        const before = await stats(ownerActor.auth, workspace.id)
        expect(before.body.revenue.revenue30d).toBe(0)
        expect(before.body.revenue.awaitingPayment).toEqual({
            count: 1,
            amount: 4500,
        })
        const awaiting = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/awaiting-payment`)
            .set(...ownerActor.auth)
        expect(awaiting.status).toBe(200)
        expect(awaiting.body.data).toHaveLength(1)
        expect(awaiting.body.data[0]).toMatchObject({
            subscriptionId: sold.body.subscription.id,
            userId: memberUser.id,
            amount: 4500,
        })

        const paid = await pay(
            ownerActor.auth,
            workspace.id,
            memberUser.id,
            sold.body.subscription.id,
            { amount: 4500 },
        )
        expect(paid.status).toBe(201)
        expect(paid.body.subscription).toMatchObject({
            isPaid: true,
            amountPaid: 4500,
        })
        expect(paid.body.subscription.paidAt).not.toBeNull()

        const after = await stats(ownerActor.auth, workspace.id)
        expect(after.body.revenue.revenue30d).toBe(4500)
        expect(after.body.revenue.awaitingPayment).toEqual({
            count: 0,
            amount: 0,
        })
    })

    it('paying twice is refused', async () => {
        const { workspace, ownerActor, memberUser, plan } = await setup()
        const sold = await sellUnpaid(
            ownerActor.auth,
            workspace.id,
            memberUser.id,
            plan.id,
        )
        const id = sold.body.subscription.id
        await pay(ownerActor.auth, workspace.id, memberUser.id, id).expect(201)

        const again = await pay(ownerActor.auth, workspace.id, memberUser.id, id)
        expect(again.status).toBe(400)
        expect(again.body.message).toMatch(/Оплата уже отмечена/)
    })

    it('a plain member cannot mark a payment', async () => {
        const { workspace, ownerActor, memberUser, memberActor, plan } =
            await setup()
        const sold = await sellUnpaid(
            ownerActor.auth,
            workspace.id,
            memberUser.id,
            plan.id,
        )
        const res = await pay(
            memberActor.auth,
            workspace.id,
            memberUser.id,
            sold.body.subscription.id,
        )
        expect(res.status).toBe(403)
        const row = await ctx.prisma.subscription.findFirstOrThrow()
        expect(row.isPaid).toBe(false)
    })

    it('an admin can undo a payment: back to awaiting, out of revenue', async () => {
        const { workspace, ownerActor, memberUser, memberActor, plan } =
            await setup()
        const sold = await sellUnpaid(
            ownerActor.auth,
            workspace.id,
            memberUser.id,
            plan.id,
        )
        const id = sold.body.subscription.id
        await pay(ownerActor.auth, workspace.id, memberUser.id, id, {
            amount: 4000,
        }).expect(201)

        const undoUrl = `/workspaces/${workspace.id}/members/${memberUser.id}/subscriptions/${id}/payment`
        const denied = await ctx
            .http()
            .delete(undoUrl)
            .set(...memberActor.auth)
        expect(denied.status).toBe(403)

        const undone = await ctx
            .http()
            .delete(undoUrl)
            .set(...ownerActor.auth)
        expect(undone.status).toBe(200)
        expect(undone.body.subscription).toMatchObject({
            isPaid: false,
            paidAt: null,
            amountPaid: 4000,
        })

        const after = await stats(ownerActor.auth, workspace.id)
        expect(after.body.revenue.revenue30d).toBe(0)
        expect(after.body.revenue.awaitingPayment).toEqual({
            count: 1,
            amount: 4000,
        })
        const awaiting = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/awaiting-payment`)
            .set(...ownerActor.auth)
        expect(awaiting.body.total).toBe(1)

        const again = await ctx
            .http()
            .delete(undoUrl)
            .set(...ownerActor.auth)
        expect(again.status).toBe(400)
        expect(again.body.message).toMatch(/Оплата не отмечена/)
    })
})
