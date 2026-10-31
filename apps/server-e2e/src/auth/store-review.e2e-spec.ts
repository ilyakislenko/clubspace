import { environment } from '../../../server/src/environments/environment'
import { clearResendCooldown } from '../support/actors'
import { addMember, createUser, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const REVIEW_EMAIL = 'store-review@clubspace.test'
const REVIEW_CODE = '730419'
const DEMO_KEY = 'store-review-demo'

// The store-review account signs in with a fixed code and, with
// STORE_REVIEW_WORKSPACE_KEY set, lands in the demo club as an ACTIVE student,
// so the reviewer sees real content instead of an empty "no club" screen.
describe('store review account and its demo club', () => {
    let ctx: TestApp
    const saved = { ...environment.storeReview }

    beforeAll(async () => {
        ctx = await createTestApp()
    })
    afterAll(async () => {
        Object.assign(environment.storeReview, saved)
        await ctx?.close()
    })
    beforeEach(async () => {
        await resetDatabase(ctx.prisma)
        await ctx.seed.onApplicationBootstrap()
        ctx.mail.clear()
        Object.assign(environment.storeReview, {
            email: REVIEW_EMAIL,
            code: REVIEW_CODE,
            workspaceKey: DEMO_KEY,
        })
    })

    const signInReviewer = async () => {
        await ctx
            .http()
            .post('/send-auth-code')
            .send({ email: REVIEW_EMAIL })
            .expect(201)
        const res = await ctx
            .http()
            .post('/sign-in')
            .send({ email: REVIEW_EMAIL, code: REVIEW_CODE })
            .expect(201)
        await clearResendCooldown(ctx, REVIEW_EMAIL)
        return res.body as { userId: string; accessToken: string }
    }

    const grants = (workspaceId: string) =>
        ctx.prisma.auditEvent.findMany({
            where: { action: 'member.grantStoreReviewAccess', workspaceId },
        })

    it('makes the reviewer an ACTIVE student of the demo club, once', async () => {
        const { workspace } = await createWorkspace(ctx, { key: DEMO_KEY })
        const reviewer = await createUser(ctx, { email: REVIEW_EMAIL })

        const session = await signInReviewer()
        expect(session.userId).toBe(reviewer.id)
        // The fixed code never sends mail.
        expect(ctx.mail.sent.filter((m) => m.to === REVIEW_EMAIL)).toEqual([])

        const member = await ctx.prisma.workspaceMember.findUniqueOrThrow({
            where: {
                userId_workspaceId: {
                    userId: reviewer.id,
                    workspaceId: workspace.id,
                },
            },
            include: { role: true },
        })
        expect(member.status).toBe('ACTIVE')
        expect(member.role.name).toBe('user')

        // The app sees the club right away.
        const mine = await ctx
            .http()
            .post('/get-my-workspaces')
            .set('Authorization', `Bearer ${session.accessToken}`)
            .send({})
            .expect(201)
        expect(
            mine.body.data.map((w: { key: string }) => w.key),
        ).toContain(DEMO_KEY)

        const [grant] = await grants(workspace.id)
        expect(grant).toMatchObject({
            targetType: 'member',
            targetId: member.id,
            actorId: reviewer.id,
            metadata: { change: 'created' },
        })

        // A second review sign-in changes nothing and audits nothing.
        await signInReviewer()
        expect(
            await ctx.prisma.workspaceMember.count({
                where: { userId: reviewer.id },
            }),
        ).toBe(1)
        expect(await grants(workspace.id)).toHaveLength(1)
    })

    it('reactivates a blocked reviewer and lifts an expired access window', async () => {
        const { workspace } = await createWorkspace(ctx, { key: DEMO_KEY })
        const reviewer = await createUser(ctx, { email: REVIEW_EMAIL })
        const { member } = await addMember(ctx, {
            workspaceId: workspace.id,
            userId: reviewer.id,
            status: 'BLOCKED',
            accessUntil: new Date(Date.now() - 86_400_000),
        })

        await signInReviewer()

        const after = await ctx.prisma.workspaceMember.findUniqueOrThrow({
            where: { id: member.id },
        })
        expect(after.status).toBe('ACTIVE')
        expect(after.accessUntil).toBeNull()
        const [grant] = await grants(workspace.id)
        expect(grant.metadata).toEqual({
            change: 'reactivated',
            previousStatus: 'BLOCKED',
            accessUntilCleared: true,
        })
    })

    it('still signs the reviewer in when the demo club does not exist', async () => {
        const reviewer = await createUser(ctx, { email: REVIEW_EMAIL })

        const session = await signInReviewer()

        expect(session.userId).toBe(reviewer.id)
        expect(
            await ctx.prisma.workspaceMember.count({
                where: { userId: reviewer.id },
            }),
        ).toBe(0)
    })

    it('leaves memberships alone when no demo club is configured', async () => {
        environment.storeReview.workspaceKey = undefined
        const { workspace } = await createWorkspace(ctx, { key: DEMO_KEY })
        const reviewer = await createUser(ctx, { email: REVIEW_EMAIL })

        await signInReviewer()

        expect(
            await ctx.prisma.workspaceMember.count({
                where: { userId: reviewer.id },
            }),
        ).toBe(0)
        expect(await grants(workspace.id)).toHaveLength(0)
    })

    it('gives a normal account signing in nothing', async () => {
        const { workspace } = await createWorkspace(ctx, { key: DEMO_KEY })
        await ctx
            .http()
            .post('/send-auth-code')
            .send({ email: 'someone@example.com' })
            .expect(201)
        const code = await ctx.mail.waitForCodeTo('someone@example.com')
        const res = await ctx
            .http()
            .post('/sign-in')
            .send({ email: 'someone@example.com', code })
            .expect(201)

        expect(
            await ctx.prisma.workspaceMember.count({
                where: { userId: res.body.userId, workspaceId: workspace.id },
            }),
        ).toBe(0)
    })
})
