import { signIn } from '../support/actors'
import { addMember, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const DAY = 24 * 3600_000

// A member asks to freeze; a coach approves through SubscriptionFreezeService.
// Against real Postgres: the unique pending slot and the claim-then-create
// race between two approvals cannot be proven with a jest.fn().
describe('freeze requests', () => {
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
        const memberActor = await signIn(ctx, memberUser.email)
        return { workspace, ownerActor, memberActor, memberUser }
    }

    const mine = (workspaceId: string) =>
        `/workspaces/${workspaceId}/me/subscription`

    const myState = async (workspaceId: string, auth: [string, string]) =>
        (await ctx.http().get(mine(workspaceId)).set(...auth).expect(200)).body

    const ask = (
        workspaceId: string,
        auth: [string, string],
        body: Record<string, unknown>,
    ) =>
        ctx
            .http()
            .post(`${mine(workspaceId)}/freeze-requests`)
            .set(...auth)
            .send(body)

    // The club-local first day the server offers, so no timezone is guessed here.
    const askFor = async (
        workspaceId: string,
        auth: [string, string],
        days = 7,
    ) => {
        const { freezeRequestWindow } = await myState(workspaceId, auth)
        return ask(workspaceId, auth, {
            fromDate: freezeRequestWindow.firstDate,
            days,
            reason: 'Травма',
        })
    }

    const decide = (
        workspaceId: string,
        auth: [string, string],
        requestId: string,
        action: 'approve' | 'decline',
        body: Record<string, unknown> = {},
    ) =>
        ctx
            .http()
            .post(`/workspaces/${workspaceId}/freeze-requests/${requestId}/${action}`)
            .set(...auth)
            .send(body)

    it('creates one pending request, shows it to the member and to the owner', async () => {
        const { workspace, ownerActor, memberActor } = await setup()

        const created = await askFor(workspace.id, memberActor.auth)
        expect(created.status).toBe(201)
        expect(created.body).toMatchObject({ status: 'PENDING', days: 7 })

        const second = await askFor(workspace.id, memberActor.auth)
        expect(second.status).toBe(409)

        const state = await myState(workspace.id, memberActor.auth)
        expect(state.freezeRequest).toMatchObject({
            id: created.body.id,
            status: 'PENDING',
        })
        expect(state.freezeRequestWindow).toBeNull()

        const queue = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/freeze-requests`)
            .set(...ownerActor.auth)
            .expect(200)
        expect(queue.body.data).toHaveLength(1)
        expect(queue.body.data[0]).toMatchObject({ id: created.body.id })
    })

    it('two parallel approvals produce exactly one freeze', async () => {
        const { workspace, ownerActor, memberActor, memberUser } = await setup()
        const created = await askFor(workspace.id, memberActor.auth)
        const sub = await ctx.prisma.subscription.findFirstOrThrow({
            where: { workspaceId: workspace.id },
        })
        const memberBefore = await ctx.prisma.workspaceMember.findFirstOrThrow({
            where: { workspaceId: workspace.id, userId: memberUser.id },
        })

        const results = await Promise.all([
            decide(workspace.id, ownerActor.auth, created.body.id, 'approve'),
            decide(workspace.id, ownerActor.auth, created.body.id, 'approve'),
        ])
        expect(results.map((r) => r.status).sort()).toEqual([201, 409])

        expect(await ctx.prisma.subscriptionFreeze.count()).toBe(1)
        const after = await ctx.prisma.subscription.findUniqueOrThrow({
            where: { id: sub.id },
        })
        const memberAfter = await ctx.prisma.workspaceMember.findFirstOrThrow({
            where: { workspaceId: workspace.id, userId: memberUser.id },
        })
        expect(after.endDate!.getTime() - sub.endDate!.getTime()).toBe(7 * DAY)
        expect(
            memberAfter.accessUntil!.getTime() - memberBefore.accessUntil!.getTime(),
        ).toBe(7 * DAY)
    })

    it('the member cannot approve, and cannot ask again while a freeze is open', async () => {
        const { workspace, ownerActor, memberActor } = await setup()
        const created = await askFor(workspace.id, memberActor.auth)

        const forbidden = await decide(
            workspace.id,
            memberActor.auth,
            created.body.id,
            'approve',
        )
        expect(forbidden.status).toBe(403)

        await decide(
            workspace.id,
            ownerActor.auth,
            created.body.id,
            'approve',
        ).expect(201)

        const state = await myState(workspace.id, memberActor.auth)
        expect(state.freeze).not.toBeNull()
        expect(state.freezeRequestWindow).toBeNull()

        const again = await ask(workspace.id, memberActor.auth, {
            fromDate: state.freeze.untilDate,
            days: 3,
            reason: 'Отпуск',
        })
        expect(again.status).toBe(400)
        expect(again.body.message).toMatch(/уже есть заморозка/)
    })

    it('a declined request shows the comment and the member can ask again', async () => {
        const { workspace, ownerActor, memberActor } = await setup()
        const created = await askFor(workspace.id, memberActor.auth)

        await decide(
            workspace.id,
            ownerActor.auth,
            created.body.id,
            'decline',
            { comment: 'Приходите в субботу' },
        ).expect(201)

        const state = await myState(workspace.id, memberActor.auth)
        expect(state.freezeRequest).toMatchObject({
            status: 'DECLINED',
            decisionComment: 'Приходите в субботу',
        })
        expect(state.freezeRequestWindow).not.toBeNull()
        expect(await ctx.prisma.subscriptionFreeze.count()).toBe(0)

        const next = await askFor(workspace.id, memberActor.auth, 3)
        expect(next.status).toBe(201)
    })

    it('a cancelled request frees the slot', async () => {
        const { workspace, memberActor } = await setup()
        const created = await askFor(workspace.id, memberActor.auth)

        await ctx
            .http()
            .post(`${mine(workspace.id)}/freeze-requests/${created.body.id}/cancel`)
            .set(...memberActor.auth)
            .expect(201)

        expect((await askFor(workspace.id, memberActor.auth)).status).toBe(201)
    })
})
