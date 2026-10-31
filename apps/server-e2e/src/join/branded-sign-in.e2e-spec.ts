import { createUser, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// Gap #11: a branded build sends its club key with every code request. That
// used to file a pending request at that club on every login — including for
// members of other clubs who merely opened the app.
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

    const sendCode = (body: Record<string, unknown>) =>
        ctx.http().post('/send-auth-code').send(body).expect(201)

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
