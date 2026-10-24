import { signIn } from '../support/actors'
import { addMember, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const DAY = 24 * 3600_000

// A freeze moves Subscription.endDate (and WorkspaceMember.accessUntil, while
// it tracks the abonement) by its length, so every date-driven reader keeps
// working. These run against real Postgres: the compare-and-set on endDate and
// the @db.Date round-trip are exactly what a jest.fn() cannot prove.
describe('freezing a member abonement', () => {
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
        await ctx
            .http()
            .post(`/workspaces/${workspace.id}/members/${memberUser.id}/subscription`)
            .set(...ownerActor.auth)
            .send({ planId: plan.id })
            .expect(201)
        const sub = await ctx.prisma.subscription.findFirstOrThrow({
            where: { workspaceId: workspace.id },
        })
        return { workspace, ownerActor, memberUser, sub }
    }

    const base = (workspaceId: string, userId: string, subscriptionId: string) =>
        `/workspaces/${workspaceId}/members/${userId}/subscriptions/${subscriptionId}`

    const freeze = (
        auth: [string, string],
        path: string,
        body: Record<string, unknown>,
    ) =>
        ctx
            .http()
            .post(`${path}/freezes`)
            .set(...auth)
            .send(body)

    const endFreeze = (auth: [string, string], path: string, freezeId: string) =>
        ctx
            .http()
            .post(`${path}/freezes/${freezeId}/end`)
            .set(...auth)

    const dates = async (workspaceId: string, userId: string, subId: string) => {
        const sub = await ctx.prisma.subscription.findUniqueOrThrow({
            where: { id: subId },
        })
        const member = await ctx.prisma.workspaceMember.findFirstOrThrow({
            where: { workspaceId, userId },
        })
        return { endDate: sub.endDate, accessUntil: member.accessUntil }
    }

    it('moves endDate and accessUntil by exactly 7 x 24h', async () => {
        const { workspace, ownerActor, memberUser, sub } = await setup()
        const before = await dates(workspace.id, memberUser.id, sub.id)

        const res = await freeze(
            ownerActor.auth,
            base(workspace.id, memberUser.id, sub.id),
            { days: 7, reason: 'Травма' },
        )
        expect(res.status).toBe(201)
        expect(res.body.freeze).toMatchObject({ days: 7, reason: 'Травма' })

        const after = await dates(workspace.id, memberUser.id, sub.id)
        expect(after.endDate!.getTime() - before.endDate!.getTime()).toBe(7 * DAY)
        expect(after.accessUntil!.getTime() - before.accessUntil!.getTime()).toBe(
            7 * DAY,
        )
        expect(res.body.accessUntil).toBe(after.accessUntil!.toISOString())
    })

    it('refuses a second freeze while one is open', async () => {
        const { workspace, ownerActor, memberUser, sub } = await setup()
        const path = base(workspace.id, memberUser.id, sub.id)
        await freeze(ownerActor.auth, path, { days: 7 }).expect(201)
        const before = await dates(workspace.id, memberUser.id, sub.id)

        const second = await freeze(ownerActor.auth, path, { days: 3 })
        expect(second.status).toBe(400)
        expect(second.body.message).toMatch(/уже есть заморозка/)
        expect(await ctx.prisma.subscriptionFreeze.count()).toBe(1)
        expect(await dates(workspace.id, memberUser.id, sub.id)).toEqual(before)
    })

    it('ending a freeze that starts today removes it and restores both dates exactly', async () => {
        const { workspace, ownerActor, memberUser, sub } = await setup()
        const path = base(workspace.id, memberUser.id, sub.id)
        const before = await dates(workspace.id, memberUser.id, sub.id)
        const created = await freeze(ownerActor.auth, path, { days: 7 }).expect(201)

        const res = await endFreeze(ownerActor.auth, path, created.body.freeze.id)
        expect(res.status).toBe(201)
        expect(res.body.freeze).toBeNull()
        expect(res.body.returnedDays).toBe(7)

        expect(await ctx.prisma.subscriptionFreeze.count()).toBe(0)
        expect(await dates(workspace.id, memberUser.id, sub.id)).toEqual(before)
    })

    it('a future freeze gives all its days back when cancelled', async () => {
        const { workspace, ownerActor, memberUser, sub } = await setup()
        const path = base(workspace.id, memberUser.id, sub.id)
        const before = await dates(workspace.id, memberUser.id, sub.id)
        const fromDate = new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10)
        const created = await freeze(ownerActor.auth, path, {
            days: 5,
            fromDate,
        }).expect(201)
        expect(created.body.freeze.fromDate).toBe(fromDate)

        const res = await endFreeze(ownerActor.auth, path, created.body.freeze.id)
        expect(res.status).toBe(201)
        expect(res.body.returnedDays).toBe(5)
        expect(await dates(workspace.id, memberUser.id, sub.id)).toEqual(before)
    })

    it('cancelling an abonement releases its upcoming freeze and restores endDate', async () => {
        const { workspace, ownerActor, memberUser, sub } = await setup()
        const path = base(workspace.id, memberUser.id, sub.id)
        const before = await dates(workspace.id, memberUser.id, sub.id)
        const fromDate = new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10)
        await freeze(ownerActor.auth, path, { days: 5, fromDate }).expect(201)

        await ctx
            .http()
            .post(`${path}/cancel`)
            .set(...ownerActor.auth)
            .expect(201)

        expect(await ctx.prisma.subscriptionFreeze.count()).toBe(0)
        const after = await dates(workspace.id, memberUser.id, sub.id)
        expect(after.endDate).toEqual(before.endDate)
        expect(after.accessUntil).toEqual(before.accessUntil)
    })

    it('refuses a plain member freezing their own abonement', async () => {
        const { workspace, memberUser, sub } = await setup()
        const memberActor = await signIn(ctx, memberUser.email)

        const res = await freeze(
            memberActor.auth,
            base(workspace.id, memberUser.id, sub.id),
            { days: 7 },
        )
        expect(res.status).toBe(403)
        expect(await ctx.prisma.subscriptionFreeze.count()).toBe(0)
    })
})
