import { environment } from '../../../server/src/environments/environment'
import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { type Actor, signIn } from '../support/actors'
import { addMember, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const PLATFORM_OWNER = 'platform-owner@clubspace.test'
const DAY = 86_400_000

// Platform billing end to end: the club's billing page (active members → tier
// → quote), the platform console's overrides and module switches, the VIDEO
// and ONLINE_PAYMENTS module gates once the trial is over, a suspended club
// closed to its members while its admin still reaches the billing page, and
// the self-serve wizard creating a club on a trial — or refusing when off.
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
        ctx.mail.clear()
        adminAuth = null
    })

    const platformAdmin = async () => {
        adminAuth ??= (await signIn(ctx, PLATFORM_OWNER)).auth
        return adminAuth
    }

    const consoleAction = async (
        workspaceId: string,
        body: Record<string, unknown>,
    ) =>
        ctx
            .http()
            .post(`/platform/workspaces/${workspaceId}/billing`)
            .set(...(await platformAdmin()))
            .send(body)

    const setModule = async (
        workspaceId: string,
        body: Record<string, unknown>,
    ) =>
        ctx
            .http()
            .post(`/platform/workspaces/${workspaceId}/modules`)
            .set(...(await platformAdmin()))
            .send(body)

    const clubBilling = (workspaceId: string, actor: Actor) =>
        ctx
            .http()
            .get(`/workspaces/${workspaceId}/billing`)
            .set(...actor.auth)

    // Ends the trial the way the console does: a 30-day period paid, no
    // modules bought.
    const markPaid = async (workspaceId: string) => {
        const res = await consoleAction(workspaceId, { kind: 'markPaid', days: 30 })
        expect(res.status).toBe(201)
        expect(res.body.billing.status).toBe('ACTIVE')
        return res
    }

    describe('club billing page', () => {
        it('a club that predates billing starts a 30-day trial with its trial modules on', async () => {
            const { workspace, owner } = await createWorkspace(ctx)
            const actor = await signIn(ctx, owner.email)
            const res = await clubBilling(workspace.id, actor).expect(200)
            expect(res.body.enabled).toBe(true)
            expect(res.body.billing).toMatchObject({
                status: 'TRIAL',
                activeMembers: 0,
                tier: { code: 'start' },
            })
            const days =
                (new Date(res.body.billing.trialEndsAt).getTime() - Date.now()) / DAY
            expect(Math.round(days)).toBe(30)
            const modules = res.body.billing.modules as Array<{
                code: string
                entitled: boolean
                source: string
            }>
            expect(modules.map((m) => m.code).sort()).toEqual([
                'BRANDED_APP',
                'ONLINE_PAYMENTS',
                'VIDEO',
            ])
            // The branded app is not part of the trial (trial-guards.e2e-spec.ts).
            for (const m of modules) {
                expect(m).toMatchObject(
                    m.code === 'BRANDED_APP'
                        ? { entitled: false, source: 'NONE' }
                        : { entitled: true, source: 'TRIAL' },
                )
            }
            expect(res.body.tiers.map((t: { code: string }) => t.code)).toEqual([
                'start',
                'club',
                'pro',
                'business',
                'network',
            ])
            // The row exists now: the trial started on this first read.
            const row = await ctx.prisma.workspaceBilling.findUniqueOrThrow({
                where: { workspaceId: workspace.id },
            })
            expect(row.status).toBe('TRIAL')
        })

        it('counts only students active in the last 30 days and quotes the first charge', async () => {
            const { workspace, owner } = await createWorkspace(ctx)
            const now = Date.now()
            const student = async (activity: {
                lastSeenAt?: Date | null
                lastAttendedAt?: Date | null
                role?: RolesEnum
                status?: 'ACTIVE' | 'INVITED'
            }) => {
                const { member } = await addMember(ctx, {
                    workspaceId: workspace.id,
                    role: activity.role,
                    status: activity.status,
                })
                await ctx.prisma.workspaceMember.update({
                    where: { id: member.id },
                    data: {
                        lastSeenAt: activity.lastSeenAt ?? null,
                        lastAttendedAt: activity.lastAttendedAt ?? null,
                    },
                })
            }
            // Active: opened the app today / trained ten days ago.
            await student({ lastSeenAt: new Date(now) })
            await student({ lastAttendedAt: new Date(now - 10 * DAY) })
            // Not counted: gone for 40 days, a coach, a pending applicant.
            await student({ lastSeenAt: new Date(now - 40 * DAY) })
            await student({ lastSeenAt: new Date(now), role: RolesEnum.COACH })
            await student({ lastSeenAt: new Date(now), status: 'INVITED' })

            // The owner asks: a student's own request would touch lastSeenAt.
            const actor = await signIn(ctx, owner.email)
            const res = await clubBilling(workspace.id, actor).expect(200)
            expect(res.body.billing).toMatchObject({
                status: 'TRIAL',
                activeMembers: 2,
                tier: { code: 'start', upTo: 50 },
                setupFee: { amount: 4990, waived: false, paidAt: null },
            })
            // The first charge after the trial: the tier plus the one-off
            // setup fee; no module was bought.
            const quote = res.body.billing.quote
            expect(quote.lines).toEqual([
                expect.objectContaining({ code: 'tier', amount: 2990 }),
                expect.objectContaining({ code: 'setup', amount: 4990 }),
            ])
            expect(quote).toMatchObject({
                subtotal: 7980,
                discount: 0,
                total: 7980,
                tierCode: 'start',
                periodMonths: 1,
            })
        })

        it('the billing page is for club admins only', async () => {
            const { workspace } = await createWorkspace(ctx)
            const { user } = await addMember(ctx, { workspaceId: workspace.id })
            const student = await signIn(ctx, user.email)
            await clubBilling(workspace.id, student).expect(403)
        })

        it("a club owner cannot read another club's billing", async () => {
            const a = await createWorkspace(ctx)
            const b = await createWorkspace(ctx)
            const ownerA = await signIn(ctx, a.owner.email)
            await clubBilling(b.workspace.id, ownerA).expect(403)
            await ctx
                .http()
                .get(`/platform/workspaces/${b.workspace.id}/billing`)
                .set(...ownerA.auth)
                .expect(403)
            await ctx
                .http()
                .post(`/platform/workspaces/${b.workspace.id}/billing`)
                .set(...ownerA.auth)
                .send({ kind: 'markPaid', days: 30 })
                .expect(403)
        })
    })

    describe('platform console', () => {
        it('is closed to club admins', async () => {
            const { workspace, owner } = await createWorkspace(ctx)
            const actor = await signIn(ctx, owner.email)
            const base = `/platform/workspaces/${workspace.id}`
            await ctx.http().get(`${base}/billing`).set(...actor.auth).expect(403)
            await ctx
                .http()
                .post(`${base}/billing`)
                .set(...actor.auth)
                .send({ kind: 'setDiscount', discountPercent: 50 })
                .expect(403)
            await ctx
                .http()
                .post(`${base}/modules`)
                .set(...actor.auth)
                .send({ module: 'VIDEO', mode: 'PAID' })
                .expect(403)
            await ctx
                .http()
                .post(`${base}/features`)
                .set(...actor.auth)
                .send({ feature: 'videos', enabled: false })
                .expect(403)
            const row = await ctx.prisma.workspaceBilling.findUnique({
                where: { workspaceId: workspace.id },
            })
            expect(row?.discountPercent ?? 0).toBe(0)
            expect(
                await ctx.prisma.workspaceModuleEntitlement.count({
                    where: { workspaceId: workspace.id },
                }),
            ).toBe(0)
        })

        it('custom price, discount and a paid module show in the quote and the journal', async () => {
            const { workspace } = await createWorkspace(ctx)

            const priced = await consoleAction(workspace.id, {
                kind: 'setCustomPrice',
                customMonthlyPrice: 1000,
            })
            expect(priced.status).toBe(201)
            expect(priced.body.overrides.customMonthlyPrice).toBe(1000)
            const discounted = await consoleAction(workspace.id, {
                kind: 'setDiscount',
                discountPercent: 10,
            })
            expect(discounted.status).toBe(201)
            expect(discounted.body.overrides.discountPercent).toBe(10)
            const video = await setModule(workspace.id, { module: 'VIDEO', mode: 'PAID' })
            expect(video.status).toBe(201)

            const card = await ctx
                .http()
                .get(`/platform/workspaces/${workspace.id}/billing`)
                .set(...(await platformAdmin()))
                .expect(200)
            expect(card.body.workspace.workspaceId).toBe(workspace.id)
            expect(card.body.overrides).toMatchObject({
                customMonthlyPrice: 1000,
                discountPercent: 10,
                setupFeeWaived: false,
                billingPeriodMonths: 1,
            })
            expect(
                card.body.billing.modules.find((m: { code: string }) => m.code === 'VIDEO'),
            ).toMatchObject({ mode: 'PAID', entitled: true, source: 'PAID' })

            const quote = card.body.billing.quote
            expect(quote.lines).toEqual([
                expect.objectContaining({ code: 'subscription', amount: 1000 }),
                expect.objectContaining({ code: 'module:VIDEO', amount: 990 }),
                expect.objectContaining({ code: 'setup', amount: 4990 }),
            ])
            // −10% on the recurring part only (1000 + 990), not the setup fee.
            expect(quote.discounts).toEqual([
                expect.objectContaining({ code: 'platform', amount: 199 }),
            ])
            expect(quote).toMatchObject({
                subtotal: 6980,
                discount: 199,
                total: 6781,
            })

            const actions = card.body.audit.map((e: { action: string }) => e.action)
            expect(actions.filter((a: string) => a === 'workspace.billingUpdate')).toHaveLength(2)
            expect(actions).toContain('workspace.moduleUpdate')
            const journal = await ctx.prisma.auditEvent.findMany({
                where: {
                    workspaceId: workspace.id,
                    action: { in: ['workspace.billingUpdate', 'workspace.moduleUpdate'] },
                },
            })
            expect(journal).toHaveLength(3)
        })
    })

    describe('VIDEO module', () => {
        const setup = async () => {
            const { workspace, owner } = await createWorkspace(ctx)
            const { user: student } = await addMember(ctx, { workspaceId: workspace.id })
            const { user: coach } = await addMember(ctx, {
                workspaceId: workspace.id,
                role: RolesEnum.COACH,
            })
            const video = await ctx.prisma.video.create({
                data: {
                    workspaceId: workspace.id,
                    title: 'lesson-1',
                    url: 'https://example.invalid/v.mp4',
                    status: 'ready',
                    hlsBucket: 'test-bucket',
                    hlsMasterKey: 'hls/lesson-1/master.m3u8',
                    rawBucket: 'test-bucket',
                    rawKey: 'raw/lesson-1/source.mp4',
                    duration: 100,
                },
            })
            const course = await ctx.prisma.course.create({
                data: {
                    workspaceId: workspace.id,
                    title: 'Базовый курс',
                    slug: 'basics',
                    publishedAt: new Date(Date.now() - 60_000),
                    videos: { create: [{ videoId: video.id, order: 0 }] },
                },
            })
            return {
                workspace,
                video,
                course,
                ownerActor: await signIn(ctx, owner.email),
                coachActor: await signIn(ctx, coach.email),
                studentActor: await signIn(ctx, student.email),
            }
        }

        const play = (videoId: string, actor: Actor) =>
            ctx.http().get(`/videos/${videoId}/playback`).set(...actor.auth)
        const listCourses = async (workspaceId: string, actor: Actor) => {
            const res = await ctx
                .http()
                .get(`/workspaces/${workspaceId}/playlists`)
                .set(...actor.auth)
                .expect(200)
            return (res.body.data as Array<{ id: string }>).map((c) => c.id)
        }

        it('after the trial, students lose videos until the module is bought; staff keep the library', async () => {
            const { workspace, video, course, ownerActor, coachActor, studentActor } =
                await setup()

            // The trial has every module on.
            expect((await play(video.id, studentActor)).status).toBe(200)
            expect(await listCourses(workspace.id, studentActor)).toEqual([course.id])

            await markPaid(workspace.id)

            const refused = await play(video.id, studentActor)
            expect(refused.status).toBe(403)
            expect(refused.body).toMatchObject({
                code: 'MODULE_NOT_ENTITLED',
                metadata: { module: 'VIDEO' },
            })
            expect(await listCourses(workspace.id, studentActor)).toEqual([])
            const detail = await ctx
                .http()
                .get(`/workspaces/${workspace.id}/playlists/${course.id}`)
                .set(...studentActor.auth)
            expect(detail.status).toBe(403)

            expect(await listCourses(workspace.id, ownerActor)).toEqual([course.id])
            expect(await listCourses(workspace.id, coachActor)).toEqual([course.id])
            expect((await play(video.id, ownerActor)).status).toBe(200)

            const billing = await clubBilling(workspace.id, ownerActor).expect(200)
            expect(
                billing.body.billing.modules.find((m: { code: string }) => m.code === 'VIDEO'),
            ).toMatchObject({ entitled: false, source: 'NONE' })

            expect(
                (await setModule(workspace.id, { module: 'VIDEO', mode: 'PAID' })).status,
            ).toBe(201)
            expect((await play(video.id, studentActor)).status).toBe(200)
            expect(await listCourses(workspace.id, studentActor)).toEqual([course.id])
        })

        it("the club's own video switch only turns on with the module", async () => {
            const { workspace, ownerActor } = await setup()
            await markPaid(workspace.id)
            const settings = (body: Record<string, unknown>) =>
                ctx
                    .http()
                    .patch(`/workspaces/${workspace.id}/settings`)
                    .set(...ownerActor.auth)
                    .send(body)

            // Switching off is always allowed; re-sending "on" while already on
            // is not turning it on.
            await settings({ videosEnabled: true }).expect(200)
            await settings({ videosEnabled: false }).expect(200)

            const refused = await settings({ videosEnabled: true })
            expect(refused.status).toBe(403)
            expect(refused.body).toMatchObject({
                code: 'MODULE_NOT_ENTITLED',
                metadata: { module: 'VIDEO' },
            })
            expect(
                (
                    await ctx.prisma.workspace.findUniqueOrThrow({
                        where: { id: workspace.id },
                    })
                ).videosEnabled,
            ).toBe(false)

            await setModule(workspace.id, { module: 'VIDEO', mode: 'PAID' })
            await settings({ videosEnabled: true }).expect(200)
        })
    })

    describe('ONLINE_PAYMENTS module', () => {
        it('without the module members cannot pay online and the admin cannot connect a provider', async () => {
            const { workspace, owner } = await createWorkspace(ctx)
            const { user } = await addMember(ctx, { workspaceId: workspace.id })
            const plan = await createPlan(ctx, {
                workspaceId: workspace.id,
                name: 'Безлимит',
                price: 4500,
                classCount: null,
            })
            await ctx.prisma.plan.update({
                where: { id: plan.id },
                data: { purchasableOnline: true },
            })
            const ownerActor = await signIn(ctx, owner.email)
            const memberActor = await signIn(ctx, user.email)

            await markPaid(workspace.id)

            const buy = await ctx
                .http()
                .post(`/workspaces/${workspace.id}/payments`)
                .set(...memberActor.auth)
                .send({ planId: plan.id })
            expect(buy.status).toBe(403)
            expect(buy.body).toMatchObject({
                code: 'MODULE_NOT_ENTITLED',
                metadata: { module: 'ONLINE_PAYMENTS' },
            })
            expect(await ctx.prisma.payment.count()).toBe(0)

            const options = await ctx
                .http()
                .get(`/workspaces/${workspace.id}/me/online-purchase`)
                .set(...memberActor.auth)
                .expect(200)
            expect(options.body).toMatchObject({ available: false, plans: [] })

            const settings = await ctx
                .http()
                .get(`/workspaces/${workspace.id}/payment-settings`)
                .set(...ownerActor.auth)
            expect(settings.status).toBe(403)
            expect(settings.body).toMatchObject({
                code: 'MODULE_NOT_ENTITLED',
                metadata: { module: 'ONLINE_PAYMENTS' },
            })

            expect(
                (await setModule(workspace.id, { module: 'ONLINE_PAYMENTS', mode: 'PAID' }))
                    .status,
            ).toBe(201)
            await ctx
                .http()
                .get(`/workspaces/${workspace.id}/payment-settings`)
                .set(...ownerActor.auth)
                .expect(200)
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
            expect(config.body).toMatchObject({ enabled: true, trialDays: 30 })

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
            expect(Math.round(days)).toBe(30)

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
