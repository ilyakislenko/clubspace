import { environment } from '../../../server/src/environments/environment'
import { clearResendCooldown, signIn, type Actor } from '../support/actors'
import { addMember, createGroupWithSlot, createPlan, createUser, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const PLATFORM_OWNER = 'platform-owner@clubspace.test'
const DEMO_KEY = 'academy-demo'
const DEMO_CODE = '730592'
const OWNER = 'owner@academy.demo'
const STUDENT = 'student@academy.demo'
const PARENT = 'parent@academy.demo'
// Two full generations per test; the acceptance bound (< 30 s each) is
// asserted explicitly below.
jest.setTimeout(180_000)

// The in-person demo kit: «Сбросить демо» rebuilds ONLY the demo club, the
// demo accounts sign in with the fixed code only while DEMO_MODE is on, and
// only a platform admin can reset.
describe('demo kit', () => {
    let ctx: TestApp
    const saved = { ...environment.demo }

    beforeAll(async () => {
        ctx = await createTestApp()
    })
    afterAll(async () => {
        Object.assign(environment.demo, saved)
        await ctx?.close()
    })
    beforeEach(async () => {
        await resetDatabase(ctx.prisma)
        await ctx.seed.onApplicationBootstrap()
        ctx.mail.clear()
        Object.assign(environment.demo, { enabled: true, workspaceKey: DEMO_KEY, code: DEMO_CODE })
    })

    const reset = (actor?: Actor) => {
        const req = ctx.http().post('/platform/demo-club/reset')
        return actor ? req.set(...actor.auth) : req
    }

    const demoCounts = async (workspaceId: string) => {
        const where = { workspaceId }
        return {
            members: await ctx.prisma.workspaceMember.count({ where }),
            groups: await ctx.prisma.group.count({ where }),
            sessions: await ctx.prisma.attendanceSession.count({ where }),
            visits: await ctx.prisma.attendanceRecord.count({ where }),
            subscriptions: await ctx.prisma.subscription.count({ where }),
            freezes: await ctx.prisma.subscriptionFreeze.count({ where }),
            promotions: await ctx.prisma.rankPromotion.count({ where }),
            announcements: await ctx.prisma.announcement.count({ where }),
            demoUsers: await ctx.prisma.user.count({ where: { isDemo: true } }),
        }
    }

    // A real club with people, a plan and a class: must come out untouched.
    const otherClub = async () => {
        const { workspace, owner } = await createWorkspace(ctx, { name: 'Настоящий клуб' })
        const { user } = await addMember(ctx, { workspaceId: workspace.id })
        await createPlan(ctx, { workspaceId: workspace.id })
        await createGroupWithSlot(ctx, { workspaceId: workspace.id, coachUserId: owner.id, dayOfWeek: 2 })
        return { workspace, owner, member: user }
    }
    const otherCounts = async (workspaceId: string) => ({
        members: await ctx.prisma.workspaceMember.count({ where: { workspaceId } }),
        plans: await ctx.prisma.plan.count({ where: { workspaceId } }),
        groups: await ctx.prisma.group.count({ where: { workspaceId } }),
        users: await ctx.prisma.user.count({ where: { isDemo: false } }),
    })

    const fixedCodeSignIn = async (email: string, code = DEMO_CODE) => {
        await clearResendCooldown(ctx, email)
        await ctx.http().post('/send-auth-code').send({ email }).expect(201)
        return ctx.http().post('/sign-in').send({ email, code })
    }

    it('lets only a platform admin reset the demo', async () => {
        const { owner } = await otherClub()
        const clubOwner = await signIn(ctx, owner.email as string)
        expect((await reset()).status).toBe(401)
        expect((await reset(clubOwner)).status).toBe(403)
        expect((await ctx.http().get('/platform/demo-club').set(...clubOwner.auth)).status).toBe(403)
        expect(await ctx.prisma.workspace.count({ where: { key: DEMO_KEY } })).toBe(0)
    })

    it('refuses to reset with demo mode off, and never touches a real club holding the key', async () => {
        const admin = await signIn(ctx, PLATFORM_OWNER)
        environment.demo.enabled = false
        expect((await reset(admin)).status).toBe(403)
        expect(await ctx.prisma.workspace.count({ where: { key: DEMO_KEY } })).toBe(0)

        environment.demo.enabled = true
        const { workspace } = await createWorkspace(ctx, { key: DEMO_KEY, name: 'Чужой клуб' })
        expect((await reset(admin)).status).toBe(400)
        expect(await ctx.prisma.workspace.findUnique({ where: { id: workspace.id } })).not.toBeNull()
    })

    it('rebuilds only the demo club, the same twice in a row, in under 30 s', async () => {
        const other = await otherClub()
        const before = await otherCounts(other.workspace.id)
        const admin = await signIn(ctx, PLATFORM_OWNER)

        const started = Date.now()
        const first = await reset(admin)
        expect(first.status).toBe(201)
        expect(Date.now() - started).toBeLessThan(30_000)
        const workspaceId = first.body.workspaceId as string
        const once = await demoCounts(workspaceId)
        expect(once.members).toBeGreaterThan(120)
        expect(once.groups).toBeGreaterThanOrEqual(10)
        expect(once.visits).toBeGreaterThan(2000)
        expect(once.freezes).toBe(3)

        const second = await reset(admin)
        expect(second.status).toBe(201)
        expect(second.body.workspaceId).toBe(workspaceId)
        expect(await demoCounts(workspaceId)).toEqual(once)
        expect(await otherCounts(other.workspace.id)).toEqual(before)
        expect(await ctx.prisma.user.findUnique({ where: { id: other.member.id } })).not.toBeNull()

        const card = await ctx.http().get('/platform/demo-club').set(...admin.auth).expect(200)
        expect(card.body).toMatchObject({
            enabled: true,
            workspaceKey: DEMO_KEY,
            loginCode: DEMO_CODE,
            workspace: { id: workspaceId, joinCode: 'ACADEMY7' },
        })
        expect(card.body.lastResetAt).not.toBeNull()
        expect(card.body.accounts.map((a: { email: string | null }) => a.email)).toEqual(
            expect.arrayContaining([OWNER, STUDENT, PARENT, null]),
        )

        // The product computes the demo's screens from the generated rows, and
        // they read as a healthy club: about one student in ten at risk, a few
        // renewals and expiring accesses, a handful of unpaid abonements and six
        // months of revenue.
        const owner = await fixedCodeSignIn(OWNER)
        expect(owner.status).toBe(201)
        const auth: [string, string] = ['Authorization', `Bearer ${owner.body.accessToken}`]
        const stats = await ctx.http().get(`/workspaces/${workspaceId}/stats`).set(...auth).expect(200)
        const students = stats.body.counts.members as number
        const share = (n: number) => n / students
        const atRisk = await ctx.http().get(`/workspaces/${workspaceId}/at-risk-members`).set(...auth).expect(200)
        expect(share(atRisk.body.summary.total)).toBeGreaterThan(0.06)
        expect(share(atRisk.body.summary.total)).toBeLessThan(0.14)
        // «Кто пропадает» has someone to call for every entry.
        expect(
            atRisk.body.data.every(
                (m: { phone: string | null; guardians: { phone: string | null }[] }) =>
                    m.phone || m.guardians.some((g) => g.phone),
            ),
        ).toBe(true)
        const renewals = await ctx.http().get(`/workspaces/${workspaceId}/renewal-candidates`).set(...auth).expect(200)
        expect(share(renewals.body.data.length)).toBeGreaterThan(0.05)
        expect(share(renewals.body.data.length)).toBeLessThan(0.2)
        expect(share(stats.body.retention.expiringSoon)).toBeLessThan(0.22)
        expect(share(stats.body.retention.inactiveMembers30d)).toBeLessThan(0.1)
        expect(stats.body.revenue.awaitingPayment.count).toBeGreaterThanOrEqual(3)
        expect(stats.body.revenue.awaitingPayment.count).toBeLessThanOrEqual(5)
        const trend = stats.body.revenue.trend as { revenue: number }[]
        expect(trend).toHaveLength(6)
        // The current month may have just begun; the five before it are full.
        expect(trend.slice(0, 5).every((m) => m.revenue > 0)).toBe(true)
        const board = await ctx.http().get(`/workspaces/${workspaceId}/leaderboard`).set(...auth).expect(200)
        expect(board.body.entries.length).toBeGreaterThan(10)
        const readiness = await ctx.http().get(`/workspaces/${workspaceId}/rank-readiness`).set(...auth).expect(200)
        expect(readiness.body.data.length).toBeGreaterThan(0)
    })

    it('signs demo accounts in with the fixed code only in demo mode', async () => {
        const admin = await signIn(ctx, PLATFORM_OWNER)
        const { body } = await reset(admin).expect(201)
        const workspaceId = body.workspaceId as string

        // No mail for a demo account: the code is fixed.
        const student = await fixedCodeSignIn(STUDENT)
        expect(student.status).toBe(201)
        expect(ctx.mail.sent.some((m) => JSON.stringify(m).includes(STUDENT))).toBe(false)
        const clubs = await ctx
            .http()
            .post('/get-my-workspaces')
            .set('Authorization', `Bearer ${student.body.accessToken}`)
            .send({})
            .expect(201)
        expect(clubs.body.data.map((w: { workspaceId: string }) => w.workspaceId)).toEqual([workspaceId])
        await ctx
            .http()
            .get(`/workspaces/${workspaceId}/me/subscription`)
            .set('Authorization', `Bearer ${student.body.accessToken}`)
            .expect(200)

        // The parent opens a child through «Я / ребёнок».
        const parent = await fixedCodeSignIn(PARENT)
        expect(parent.status).toBe(201)
        const child = await ctx.prisma.guardianship.findFirstOrThrow({
            where: { guardianId: parent.body.userId, consentAt: { not: null } },
        })
        const childClubs = await ctx
            .http()
            .post('/get-my-workspaces')
            .set('Authorization', `Bearer ${parent.body.accessToken}`)
            .set('X-Act-As', child.dependentId)
            .send({})
            .expect(201)
        expect(childClubs.body.data.map((w: { workspaceId: string }) => w.workspaceId)).toEqual([workspaceId])

        // A wrong code is a wrong code.
        expect((await fixedCodeSignIn(OWNER, '918273')).status).not.toBe(201)

        // A normal account never opens with the demo code.
        await createUser(ctx, { email: 'someone@example.com' })
        expect((await fixedCodeSignIn('someone@example.com')).status).not.toBe(201)

        // A demo account that also belongs to a real club is refused.
        const other = await otherClub()
        const ownerUser = await ctx.prisma.user.findUniqueOrThrow({ where: { email: OWNER } })
        const extra = await addMember(ctx, { workspaceId: other.workspace.id, userId: ownerUser.id })
        expect((await fixedCodeSignIn(OWNER)).status).not.toBe(201)
        await ctx.prisma.workspaceMember.delete({ where: { id: extra.member.id } })

        // Demo mode off: the fixed code opens nothing.
        environment.demo.enabled = false
        expect((await fixedCodeSignIn(OWNER)).status).not.toBe(201)
        environment.demo.enabled = true
        expect((await fixedCodeSignIn(OWNER)).status).toBe(201)
    })

    it('keeps the demo accounts signed in across a reset', async () => {
        const admin = await signIn(ctx, PLATFORM_OWNER)
        await reset(admin).expect(201)
        const student = await fixedCodeSignIn(STUDENT)
        await reset(admin).expect(201)
        const refreshed = await ctx
            .http()
            .post('/refresh-token')
            .send({ refreshToken: student.body.refreshToken })
        expect(refreshed.status).toBe(201)

        environment.demo.enabled = false
        const blocked = await ctx
            .http()
            .post('/refresh-token')
            .send({ refreshToken: refreshed.body.refreshToken })
        expect(blocked.status).not.toBe(201)
    })
})
