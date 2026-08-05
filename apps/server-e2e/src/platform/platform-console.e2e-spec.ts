import { signIn } from '../support/actors'
import { createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const PLATFORM_OWNER = 'platform-owner@clubspace.test'

// The console sits a tier above club admin: it creates clubs and hands them to
// owners. Its gate is isSuperAdmin, not club membership, so it is the one place
// where being an owner — even of every club — must not be enough.
describe('platform console', () => {
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

    const ROUTES: Array<[string, string]> = [
        ['GET', '/platform/overview'],
        ['GET', '/platform/workspaces'],
        ['POST', '/platform/workspaces'],
        ['GET', '/platform/audit'],
    ]

    describe.each(ROUTES)('%s %s', (method, route) => {
        it('refuses a club owner', async () => {
            const { owner } = await createWorkspace(ctx)
            const actor = await signIn(ctx, owner.email)

            const res = await ctx
                .http()
                [method.toLowerCase() as 'get' | 'post'](route)
                .set(...actor.auth)
                .send({})

            expect(res.status).toBe(403)
        })

        it('refuses an unauthenticated caller', async () => {
            const res = await ctx
                .http()
                [method.toLowerCase() as 'get' | 'post'](route)
                .send({})

            expect(res.status).toBe(401)
        })
    })

    it('bootstraps the platform owner from SUPER_ADMIN_EMAIL', async () => {
        const user = await ctx.prisma.user.findUnique({
            where: { email: PLATFORM_OWNER },
            select: { isSuperAdmin: true, password: true },
        })

        expect(user?.isSuperAdmin).toBe(true)
        // Sign-in is an emailed code compared against completeCode; nothing
        // reads User.password. A seeded password here would be a credential
        // that looks meaningful and authenticates nothing.
        expect(user?.password ?? null).toBeNull()
    })

    it('creates a club and makes the named email its owner', async () => {
        const admin = await signIn(ctx, PLATFORM_OWNER)

        const res = await ctx
            .http()
            .post('/platform/workspaces')
            .set(...admin.auth)
            .send({
                name: 'Академия Дзюдо',
                ownerEmail: 'newowner@example.com',
                type: 'GRAPPLING',
            })

        expect(res.status).toBe(201)

        const workspace = await ctx.prisma.workspace.findFirstOrThrow({
            where: { name: 'Академия Дзюдо' },
            select: { id: true, key: true, ownerId: true },
        })
        // A Cyrillic club name has to transliterate into a key that is safe in
        // a URL and in the mobile deep links built from it — no Cyrillic, no
        // spaces, no percent-encoding.
        expect(workspace.key).toMatch(/^[a-z0-9_-]+$/)
        expect(workspace.key).toContain('akademiya')

        const owner = await ctx.prisma.user.findUniqueOrThrow({
            where: { id: workspace.ownerId },
            select: { email: true, isSuperAdmin: true },
        })
        expect(owner.email).toBe('newowner@example.com')
        // Being handed a club must not confer platform rights.
        expect(owner.isSuperAdmin).toBe(false)
    })

    it('gives the new owner working access to their club', async () => {
        const admin = await signIn(ctx, PLATFORM_OWNER)
        await ctx
            .http()
            .post('/platform/workspaces')
            .set(...admin.auth)
            .send({
                name: 'Handover Club',
                ownerEmail: 'handover@example.com',
                type: 'FITNESS',
            })
            .expect(201)

        const workspace = await ctx.prisma.workspace.findFirstOrThrow({
            where: { name: 'Handover Club' },
        })

        // The whole point of the console. If this fails, the feature ships a
        // club its owner cannot open.
        const ownerActor = await signIn(ctx, 'handover@example.com')
        await ctx
            .http()
            .get(`/workspaces/${workspace.id}/members`)
            .set(...ownerActor.auth)
            .expect(200)
    })

    it('refuses a duplicate club key', async () => {
        const admin = await signIn(ctx, PLATFORM_OWNER)
        const body = {
            name: 'Twice Club',
            ownerEmail: 'twice@example.com',
            type: 'GRAPPLING',
        }
        await ctx
            .http()
            .post('/platform/workspaces')
            .set(...admin.auth)
            .send({ ...body, key: 'twice-club' })
            .expect(201)

        const res = await ctx
            .http()
            .post('/platform/workspaces')
            .set(...admin.auth)
            .send({ ...body, key: 'twice-club' })

        expect(res.status).toBeGreaterThanOrEqual(400)
        expect(res.status).toBeLessThan(500)
    })

    it('records the creation in the platform journal', async () => {
        const admin = await signIn(ctx, PLATFORM_OWNER)
        await ctx
            .http()
            .post('/platform/workspaces')
            .set(...admin.auth)
            .send({
                name: 'Audited Club',
                ownerEmail: 'audited@example.com',
                type: 'YOGA',
            })
            .expect(201)

        const res = await ctx
            .http()
            .get('/platform/audit')
            .set(...admin.auth)
            .expect(200)

        const actions = (res.body.data as Array<{ action: string }>).map(
            (e) => e.action,
        )
        expect(actions).toContain('workspace.create')
    })

    it('rejects a club with no name', async () => {
        const admin = await signIn(ctx, PLATFORM_OWNER)

        const res = await ctx
            .http()
            .post('/platform/workspaces')
            .set(...admin.auth)
            .send({ ownerEmail: 'noname@example.com', type: 'GRAPPLING' })

        expect(res.status).toBe(400)
    })

    it('rejects a malformed owner email', async () => {
        const admin = await signIn(ctx, PLATFORM_OWNER)

        const res = await ctx
            .http()
            .post('/platform/workspaces')
            .set(...admin.auth)
            .send({ name: 'Bad Email Club', ownerEmail: 'not-an-email', type: 'GRAPPLING' })

        expect(res.status).toBe(400)
    })
})
