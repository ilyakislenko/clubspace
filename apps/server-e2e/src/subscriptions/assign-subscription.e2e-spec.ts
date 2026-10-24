import { signIn } from '../support/actors'
import { addMember, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// The bug cluster this file exists for: WorkspaceMember.subscriptionId is a
// plain pointer with no expiry job behind it, so it outlives the subscription's
// own validity. Seven separate readers trusted it, and a member with a
// long-expired abonement read as "on a current plan" in the admin list, the
// export, the renewal candidates and their own app.
describe('assigning a subscription to a member', () => {
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
            classCount: 12,
            durationDays: 30,
        })
        const ownerActor = await signIn(ctx, owner.email)
        return { workspace, owner, ownerActor, memberUser, plan }
    }

    const assign = (
        actorAuth: [string, string],
        workspaceId: string,
        userId: string,
        planId: string,
    ) =>
        ctx
            .http()
            .post(`/workspaces/${workspaceId}/members/${userId}/subscription`)
            .set(...actorAuth)
            .send({ planId })

    it('grants the pack with its full class balance', async () => {
        const { workspace, ownerActor, memberUser, plan } = await setup()

        const res = await assign(
            ownerActor.auth,
            workspace.id,
            memberUser.id,
            plan.id,
        )
        expect(res.status).toBe(201)

        const sub = await ctx.prisma.subscription.findFirstOrThrow({
            where: { workspaceId: workspace.id },
        })
        // The reported symptom was "I assigned a 12-class pack and it says the
        // member has no classes left."
        expect(sub.classesTotal).toBe(12)
        expect(sub.classesRemaining).toBe(12)
        expect(sub.status).toBe('ACTIVE')
    })

    it('points the member at the new subscription and sets their access window', async () => {
        const { workspace, ownerActor, memberUser, plan } = await setup()
        await assign(ownerActor.auth, workspace.id, memberUser.id, plan.id)

        const member = await ctx.prisma.workspaceMember.findFirstOrThrow({
            where: { userId: memberUser.id, workspaceId: workspace.id },
        })
        expect(member.subscriptionId).not.toBeNull()
        expect(member.accessUntil).not.toBeNull()
    })

    // The 400 the user hit in the browser. Refusing is correct; the point of
    // the test is that it refuses rather than silently stacking two live packs
    // and losing track of which one burns down.
    it('refuses to stack a second subscription on a member who already has one', async () => {
        const { workspace, ownerActor, memberUser, plan } = await setup()
        await assign(ownerActor.auth, workspace.id, memberUser.id, plan.id).expect(201)

        const second = await assign(
            ownerActor.auth,
            workspace.id,
            memberUser.id,
            plan.id,
        )

        expect(second.status).toBe(400)
        // A refusal has to say what is in the way, or the admin has no idea
        // what to do next. This is the assertion that would have caught the
        // "Request failed with status code 400" the UI used to show.
        expect(typeof second.body.message).toBe('string')
        expect(second.body.message.length).toBeGreaterThan(10)
        expect(await ctx.prisma.subscription.count()).toBe(1)
    })

    it('allows a new subscription once the previous one has expired', async () => {
        const { workspace, ownerActor, memberUser, plan } = await setup()
        await assign(ownerActor.auth, workspace.id, memberUser.id, plan.id).expect(201)

        // Push the existing one into the past — the state a member is in when
        // they come back next month.
        await ctx.prisma.subscription.updateMany({
            where: { workspaceId: workspace.id },
            data: { endDate: new Date(Date.now() - 24 * 3600_000) },
        })

        const renewed = await assign(
            ownerActor.auth,
            workspace.id,
            memberUser.id,
            plan.id,
        )
        expect(renewed.status).toBe(201)
        expect(await ctx.prisma.subscription.count()).toBe(2)
    })

    it('an exhausted pack does not block a new sale, is closed as EXPIRED, and keeps app access', async () => {
        const { workspace, ownerActor, memberUser, plan } = await setup()
        await assign(ownerActor.auth, workspace.id, memberUser.id, plan.id).expect(201)
        const old = await ctx.prisma.subscription.findFirstOrThrow({
            where: { workspaceId: workspace.id },
        })

        // Burn the balance without touching the window.
        await ctx.prisma.subscription.update({
            where: { id: old.id },
            data: { classesRemaining: 0 },
        })

        // Coaches sell 8/12 packs daily: a pack with nothing left must not
        // demand an admin cancel first. Running out of classes must also never
        // revoke app access.
        const second = await assign(
            ownerActor.auth,
            workspace.id,
            memberUser.id,
            plan.id,
        )
        expect(second.status).toBe(201)

        expect(
            (await ctx.prisma.subscription.findUniqueOrThrow({ where: { id: old.id } }))
                .status,
        ).toBe('EXPIRED')
        const member = await ctx.prisma.workspaceMember.findFirstOrThrow({
            where: { userId: memberUser.id, workspaceId: workspace.id },
        })
        expect(member.subscriptionId).toBe(second.body.subscription.id)
        expect(member.accessUntil).not.toBeNull()
    })

    it('shows an expired subscription as not current in the member list', async () => {
        const { workspace, ownerActor, memberUser, plan } = await setup()
        await assign(ownerActor.auth, workspace.id, memberUser.id, plan.id).expect(201)
        await ctx.prisma.subscription.updateMany({
            where: { workspaceId: workspace.id },
            data: { endDate: new Date(Date.now() - 24 * 3600_000) },
        })

        const res = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/members`)
            .set(...ownerActor.auth)
            .expect(200)

        const row = (res.body.data as Array<{ userId: string; subscription: unknown }>)
            .find((m) => m.userId === memberUser.id)
        expect(row).toBeDefined()
        // The pointer still references the row; the reader must check validity
        // rather than trust it.
        expect(row?.subscription ?? null).toBeNull()
    })

    it('reports no current subscription to the member themselves once it expires', async () => {
        const { workspace, ownerActor, memberUser, plan } = await setup()
        await assign(ownerActor.auth, workspace.id, memberUser.id, plan.id).expect(201)
        await ctx.prisma.subscription.updateMany({
            where: { workspaceId: workspace.id },
            data: { endDate: new Date(Date.now() - 24 * 3600_000) },
        })

        const memberActor = await signIn(ctx, memberUser.email)
        const res = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/me/subscription`)
            .set(...memberActor.auth)
            .expect(200)

        expect(res.body.subscription ?? null).toBeNull()
    })

    it('refuses a plan belonging to another club', async () => {
        const { workspace, ownerActor, memberUser } = await setup()
        const other = await createWorkspace(ctx)
        const foreignPlan = await createPlan(ctx, {
            workspaceId: other.workspace.id,
        })

        const res = await assign(
            ownerActor.auth,
            workspace.id,
            memberUser.id,
            foreignPlan.id,
        )
        expect(res.status).toBeGreaterThanOrEqual(400)
        expect(await ctx.prisma.subscription.count()).toBe(0)
    })

    it('refuses a plain member trying to assign themselves a subscription', async () => {
        const { workspace, memberUser, plan } = await setup()
        const memberActor = await signIn(ctx, memberUser.email)

        const res = await assign(
            memberActor.auth,
            workspace.id,
            memberUser.id,
            plan.id,
        )
        expect(res.status).toBe(403)
        expect(await ctx.prisma.subscription.count()).toBe(0)
    })

    it('refuses an owner of a different club', async () => {
        const { workspace, memberUser, plan } = await setup()
        const outsider = await createWorkspace(ctx)
        const outsiderActor = await signIn(ctx, outsider.owner.email)

        const res = await assign(
            outsiderActor.auth,
            workspace.id,
            memberUser.id,
            plan.id,
        )
        expect(res.status).toBeGreaterThanOrEqual(400)
        expect(res.status).toBeLessThan(500)
        expect(await ctx.prisma.subscription.count()).toBe(0)
    })

    it('refuses an unauthenticated request', async () => {
        const { workspace, memberUser, plan } = await setup()

        await ctx
            .http()
            .post(`/workspaces/${workspace.id}/members/${memberUser.id}/subscription`)
            .send({ planId: plan.id })
            .expect(401)
    })
})
