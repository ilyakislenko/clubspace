import { PlatformBillingService } from '../../../server/src/domains/billing/services/platform-billing.service'
import { environment } from '../../../server/src/environments/environment'
import { signIn } from '../support/actors'
import { addMember, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const PLATFORM_OWNER = 'platform-owner@clubspace.test'

// Platform billing end to end: plan limits refuse the write with a typed
// error, a suspended club is closed to its members while its admin can still
// reach the billing page, and the self-serve wizard creates a club on a trial
// — or refuses when the flag is off.
describe('platform billing', () => {
    let ctx: TestApp

    beforeAll(async () => {
        ctx = await createTestApp()
    })
    afterAll(async () => {
        await ctx?.close()
    })
    // The platform admin signs in once per test: a second code to the same
    // address would hit the resend cooldown.
    let adminAuth: [string, string] | null = null

    beforeEach(async () => {
        await resetDatabase(ctx.prisma)
        await ctx.seed.onApplicationBootstrap()
        // The plan rows were truncated with everything else.
        await ctx.app.get(PlatformBillingService).syncPlans()
        ctx.mail.clear()
        adminAuth = null
    })

    const consoleAction = async (
        workspaceId: string,
        body: Record<string, unknown>,
    ) => {
        adminAuth ??= (await signIn(ctx, PLATFORM_OWNER)).auth
        return ctx
            .http()
            .post(`/platform/workspaces/${workspaceId}/billing`)
            .set(...adminAuth)
            .send(body)
    }

    describe('plan limits', () => {
        it('refuses a member past the plan limit with PLAN_LIMIT_REACHED', async () => {
            // A one-member Free plan, set from the platform console.
            await ctx.prisma.platformPlan.update({
                where: { code: 'free' },
                data: { maxMembers: 1 },
            })
            const free = await ctx.prisma.platformPlan.findUniqueOrThrow({
                where: { code: 'free' },
            })
            const { workspace, owner } = await createWorkspace(ctx)
            await consoleAction(workspace.id, {
                kind: 'changePlan',
                planId: free.id,
            }).then((res) => expect(res.status).toBe(201))

            const actor = await signIn(ctx, owner.email)
            await ctx
                .http()
                .post(`/workspaces/${workspace.id}/members`)
                .set(...actor.auth)
                .send({ email: 'first@example.com' })
                .expect(201)

            const refused = await ctx
                .http()
                .post(`/workspaces/${workspace.id}/members`)
                .set(...actor.auth)
                .send({ email: 'second@example.com' })
            expect(refused.status).toBe(403)
            expect(refused.body.code).toBe('PLAN_LIMIT_REACHED')
            expect(refused.body.metadata).toEqual({
                limit: 'members',
                max: 1,
                used: 1,
                planName: free.name,
            })
            // Refused before the account was made.
            expect(
                await ctx.prisma.user.findUnique({
                    where: { email: 'second@example.com' },
                }),
            ).toBeNull()

            const billing = await ctx
                .http()
                .get(`/workspaces/${workspace.id}/billing`)
                .set(...actor.auth)
                .expect(200)
            expect(billing.body.billing.plan.code).toBe('free')
            // The owner's own row never counts.
            expect(billing.body.billing.usage.members).toBe(1)
        })

        it('a club that predates billing gets the default plan, no expiry', async () => {
            const { workspace, owner } = await createWorkspace(ctx)
            const actor = await signIn(ctx, owner.email)
            const res = await ctx
                .http()
                .get(`/workspaces/${workspace.id}/billing`)
                .set(...actor.auth)
                .expect(200)
            expect(res.body.enabled).toBe(true)
            expect(res.body.billing).toMatchObject({
                status: 'ACTIVE',
                plan: { code: environment.billing.defaultPlanCode },
                currentPeriodEnd: null,
            })
            expect(res.body.plans.map((p: { code: string }) => p.code)).toEqual([
                'free',
                'club',
                'pro',
            ])
        })

        it('the billing page is for club admins only', async () => {
            const { workspace } = await createWorkspace(ctx)
            const { user } = await addMember(ctx, { workspaceId: workspace.id })
            const student = await signIn(ctx, user.email)
            await ctx
                .http()
                .get(`/workspaces/${workspace.id}/billing`)
                .set(...student.auth)
                .expect(403)
        })
    })

    describe('suspension', () => {
        it('a suspended club refuses its members; the admin still reaches billing', async () => {
            const { workspace, owner } = await createWorkspace(ctx, {
                name: 'Спящий клуб',
            })
            const { user } = await addMember(ctx, { workspaceId: workspace.id })
            const student = await signIn(ctx, user.email)
            const ownerActor = await signIn(ctx, owner.email)

            await ctx
                .http()
                .get(`/workspaces/${workspace.id}/events`)
                .set(...student.auth)
                .expect(200)

            expect((await consoleAction(workspace.id, { kind: 'suspend' })).status).toBe(201)

            const refused = await ctx
                .http()
                .get(`/workspaces/${workspace.id}/events`)
                .set(...student.auth)
            expect(refused.status).toBe(403)
            expect(refused.body).toMatchObject({
                code: 'WORKSPACE_SUSPENDED',
                metadata: {
                    workspaceId: workspace.id,
                    workspaceName: 'Спящий клуб',
                    reason: 'SUSPENDED',
                },
            })

            // The owner is closed out of club routes too…
            await ctx
                .http()
                .get(`/workspaces/${workspace.id}/events`)
                .set(...ownerActor.auth)
                .expect(403)
            // …but sees the billing page and their own role.
            const billing = await ctx
                .http()
                .get(`/workspaces/${workspace.id}/billing`)
                .set(...ownerActor.auth)
                .expect(200)
            expect(billing.body.billing.status).toBe('SUSPENDED')
            await ctx
                .http()
                .get(`/workspaces/${workspace.id}/members/me`)
                .set(...ownerActor.auth)
                .expect(200)

            expect((await consoleAction(workspace.id, { kind: 'resume' })).status).toBe(201)
            await ctx
                .http()
                .get(`/workspaces/${workspace.id}/events`)
                .set(...student.auth)
                .expect(200)
        })

        it('a club the platform switched off is closed with reason INACTIVE', async () => {
            const { workspace } = await createWorkspace(ctx, { isActive: false })
            const { user } = await addMember(ctx, { workspaceId: workspace.id })
            const student = await signIn(ctx, user.email)
            const res = await ctx
                .http()
                .get(`/workspaces/${workspace.id}/events`)
                .set(...student.auth)
            expect(res.status).toBe(403)
            expect(res.body.code).toBe('WORKSPACE_SUSPENDED')
            expect(res.body.metadata.reason).toBe('INACTIVE')
        })
    })

    describe('self-serve club creation', () => {
        afterEach(() => {
            environment.billing.selfServeSignupEnabled = true
        })

        it('creates a club owned by the signed-in account on a trial, once', async () => {
            const config = await ctx.http().get('/self-serve/config').expect(200)
            expect(config.body).toMatchObject({ enabled: true, trialDays: 14 })

            const founder = await signIn(ctx, 'founder@example.com')
            const res = await ctx
                .http()
                .post('/self-serve/workspaces')
                .set(...founder.auth)
                .send({
                    name: 'Йога на Садовой',
                    type: 'YOGA',
                    timezone: 'Europe/Samara',
                    city: 'Самара',
                })
            expect(res.status).toBe(201)
            expect(res.body).toMatchObject({ status: 'TRIAL', name: 'Йога на Садовой' })

            const workspace = await ctx.prisma.workspace.findUniqueOrThrow({
                where: { id: res.body.workspaceId },
                include: { billing: true },
            })
            expect(workspace).toMatchObject({
                ownerId: founder.userId,
                type: 'YOGA',
                timezone: 'Europe/Samara',
                city: 'Самара',
            })
            expect(workspace.billing?.status).toBe('TRIAL')
            const days =
                (workspace.billing!.trialEndsAt!.getTime() - Date.now()) / 86_400_000
            expect(Math.round(days)).toBe(14)

            // The founder lands in their club with admin rights…
            await ctx
                .http()
                .get(`/workspaces/${workspace.id}/onboarding`)
                .set(...founder.auth)
                .expect(200)
                .then((r) => expect(r.body.doneCount).toBe(0))
            // …and the creation is in the club's journal.
            const audit = await ctx.prisma.auditEvent.findFirstOrThrow({
                where: { workspaceId: workspace.id, action: 'workspace.create' },
            })
            expect(audit.actorId).toBe(founder.userId)

            // One trial per account.
            const again = await ctx
                .http()
                .post('/self-serve/workspaces')
                .set(...founder.auth)
                .send({ name: 'Второй клуб', type: 'FITNESS', timezone: 'Europe/Moscow' })
            expect(again.status).toBe(409)
        })

        it('is refused when SELF_SERVE_SIGNUP_ENABLED is off', async () => {
            environment.billing.selfServeSignupEnabled = false
            const config = await ctx.http().get('/self-serve/config').expect(200)
            expect(config.body.enabled).toBe(false)

            const founder = await signIn(ctx, 'founder@example.com')
            const res = await ctx
                .http()
                .post('/self-serve/workspaces')
                .set(...founder.auth)
                .send({ name: 'Клуб', type: 'FITNESS', timezone: 'Europe/Moscow' })
            expect(res.status).toBe(403)
            expect(await ctx.prisma.workspace.count()).toBe(0)
        })

        it('needs a signed-in account', async () => {
            await ctx
                .http()
                .post('/self-serve/workspaces')
                .send({ name: 'Клуб', type: 'FITNESS', timezone: 'Europe/Moscow' })
                .expect(401)
        })
    })
})
