import { createUser, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// Gap #11: a branded build sends its club key with every code request. That
// used to file a pending request at that club on every login — including for
// members of other clubs who merely opened the app. The request is filed only
// once the emailed code is entered.
describe('send-auth-code with a club key', () => {
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

    const requests = async (workspaceId: string, email: string) =>
        ctx.prisma.workspaceMember.count({
            where: { workspaceId, user: { email }, status: 'INVITED' },
        })

    // Requests the code with the club key, checks nothing was filed before
    // the address is proven, then enters the code.
    const sendCode = async (body: { email: string } & Record<string, unknown>) => {
        await ctx.http().post('/send-auth-code').send(body).expect(201)
        const code = await ctx.mail.waitForCodeTo(body.email)
        expect(
            await ctx.prisma.workspaceMember.count({
                where: { user: { email: body.email }, status: 'INVITED' },
            }),
        ).toBe(0)
        await ctx.http().post('/sign-in').send({ email: body.email, code }).expect(201)
    }

    it('files a request for a brand-new account when the flag is omitted', async () => {
        const { workspace } = await createWorkspace(ctx)
        await sendCode({ email: 'new@example.com', workspaceKey: workspace.key })
        expect(await requests(workspace.id, 'new@example.com')).toBe(1)
    })

    it('files nothing for an existing account when the flag is omitted', async () => {
        const { workspace } = await createWorkspace(ctx)
        await createUser(ctx, { email: 'member-elsewhere@example.com' })
        await sendCode({
            email: 'member-elsewhere@example.com',
            workspaceKey: workspace.key,
        })
        expect(await requests(workspace.id, 'member-elsewhere@example.com')).toBe(0)
    })

    it('files nothing for a new address whose code is never entered', async () => {
        const { workspace } = await createWorkspace(ctx)
        await ctx
            .http()
            .post('/send-auth-code')
            .send({ email: 'drive-by@example.com', workspaceKey: workspace.key })
            .expect(201)
        await ctx.mail.waitForCodeTo('drive-by@example.com')
        await ctx
            .http()
            .post('/sign-in')
            .send({ email: 'drive-by@example.com', code: '000000' })
        expect(
            await ctx.prisma.workspaceMember.count({
                where: { workspaceId: workspace.id, status: 'INVITED' },
            }),
        ).toBe(0)
        expect(await ctx.prisma.user.count({ where: { email: 'drive-by@example.com' } })).toBe(0)
    })

    it('files nothing when the app says not to, even for a new account', async () => {
        const { workspace } = await createWorkspace(ctx)
        await sendCode({
            email: 'new@example.com',
            workspaceKey: workspace.key,
            requestJoin: false,
        })
        expect(await requests(workspace.id, 'new@example.com')).toBe(0)
    })

    it('files a request for an existing account that explicitly asks', async () => {
        const { workspace } = await createWorkspace(ctx)
        await createUser(ctx, { email: 'joiner@example.com' })
        await sendCode({
            email: 'joiner@example.com',
            workspaceKey: workspace.key,
            requestJoin: true,
        })
        expect(await requests(workspace.id, 'joiner@example.com')).toBe(1)
    })
})
