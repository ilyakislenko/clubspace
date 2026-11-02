import { signIn } from '../support/actors'
import { addMember, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// Removing a member ends the membership, not the club's sales history: their
// abonements stay (no member, the buyer kept) — still revenue, never a debt,
// an active abonement or anything else a current list shows. Account deletion
// keeps them the same way. Real Postgres: the FK's SetNull is the point.
describe('abonements of a removed member', () => {
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
        const { user: payer } = await addMember(ctx, { workspaceId: workspace.id })
        const { user: debtor } = await addMember(ctx, { workspaceId: workspace.id })
        const plan = await createPlan(ctx, { workspaceId: workspace.id, durationDays: 30 })
        const ownerActor = await signIn(ctx, owner.email)
        const sell = (userId: string, paid: boolean) =>
            ctx
                .http()
                .post(`/workspaces/${workspace.id}/members/${userId}/subscription`)
                .set(...ownerActor.auth)
                .send({ planId: plan.id, amountPaid: 4500, paid })
                .expect(201)
        await sell(payer.id, true)
        await sell(debtor.id, false)
        return { workspace, ownerActor, payer, debtor }
    }

    const stats = (auth: [string, string], workspaceId: string) =>
        ctx.http().get(`/workspaces/${workspaceId}/stats`).set(...auth).expect(200)

    it('keeps revenue and drops the debt and the active count', async () => {
        const { workspace, ownerActor, payer, debtor } = await setup()
        const before = await stats(ownerActor.auth, workspace.id)
        expect(before.body.revenue).toMatchObject({
            revenue30d: 4500,
            activeSubscriptions: 2,
            awaitingPayment: { count: 1, amount: 4500 },
        })

        for (const userId of [payer.id, debtor.id]) {
            await ctx
                .http()
                .delete(`/workspaces/${workspace.id}/members/${userId}`)
                .set(...ownerActor.auth)
                .expect(200)
        }

        const rows = await ctx.prisma.subscription.findMany({ where: { workspaceId: workspace.id } })
        expect(rows).toHaveLength(2)
        expect(rows.every((r) => r.workspaceMemberId === null)).toBe(true)
        expect(rows.map((r) => r.userId).sort()).toEqual([payer.id, debtor.id].sort())

        const after = await stats(ownerActor.auth, workspace.id)
        expect(after.body.revenue).toMatchObject({
            revenue30d: 4500,
            activeSubscriptions: 0,
            awaitingPayment: { count: 0, amount: 0 },
        })
        expect(after.body.revenue.trend.at(-1).revenue).toBe(4500)

        const awaiting = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/awaiting-payment`)
            .set(...ownerActor.auth)
            .expect(200)
        expect(awaiting.body.data).toEqual([])

        const csv = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/exports/revenue.csv`)
            .set(...ownerActor.auth)
            .expect(200)
        expect(csv.text).toContain(payer.email)
    })

    it('a member who rejoins starts a new membership; the old abonement stays history', async () => {
        const { workspace, ownerActor, payer } = await setup()
        const old = await ctx.prisma.subscription.findFirstOrThrow({ where: { userId: payer.id } })
        await ctx
            .http()
            .delete(`/workspaces/${workspace.id}/members/${payer.id}`)
            .set(...ownerActor.auth)
            .expect(200)
        await addMember(ctx, { workspaceId: workspace.id, userId: payer.id })

        const list = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/members/${payer.id}/subscriptions`)
            .set(...ownerActor.auth)
            .expect(200)
        expect(JSON.stringify(list.body)).not.toContain(old.id)
        const after = await stats(ownerActor.auth, workspace.id)
        expect(after.body.revenue.revenue30d).toBe(4500)
    })

    it('account deletion keeps the sales, like payments', async () => {
        const { workspace, payer } = await setup()
        const actor = await signIn(ctx, payer.email!)
        await ctx.http().delete('/me').set(...actor.auth).expect(200)

        const rows = await ctx.prisma.subscription.findMany({
            where: { workspaceId: workspace.id, userId: payer.id },
        })
        expect(rows).toHaveLength(1)
        expect(rows[0].workspaceMemberId).toBeNull()
        const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: payer.id } })
        expect(user.email).not.toBe(payer.email)
    })
})
