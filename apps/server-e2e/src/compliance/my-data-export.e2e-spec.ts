import { signIn } from '../support/actors'
import { addMember, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// 152-ФЗ ст. 14 / GDPR art. 15: a member downloads what the platform keeps
// about them, without asking a club admin.
describe('self-service data export', () => {
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

    it('returns the caller’s own data across clubs as a JSON download and audits it', async () => {
        const { workspace } = await createWorkspace(ctx, { name: 'Клуб А' })
        const { user } = await addMember(ctx, { workspaceId: workspace.id })
        const { user: other } = await addMember(ctx, {
            workspaceId: workspace.id,
        })
        await ctx.prisma.trainingJournalEntry.createMany({
            data: [
                {
                    workspaceId: workspace.id,
                    userId: user.id,
                    entryDate: new Date('2026-10-01T00:00:00Z'),
                    body: 'мой разбор',
                },
                {
                    workspaceId: workspace.id,
                    userId: other.id,
                    entryDate: new Date('2026-10-01T00:00:00Z'),
                    body: 'чужой разбор',
                },
            ],
        })
        const actor = await signIn(ctx, user.email)

        const res = await ctx
            .http()
            .get('/me/export')
            .set(...actor.auth)
            .expect(200)

        expect(res.headers['content-disposition']).toMatch(
            /^attachment; filename="clubspace-my-data-\d{4}-\d{2}-\d{2}\.json"$/,
        )
        expect(res.body.profile).toMatchObject({
            id: user.id,
            email: user.email,
        })
        expect(res.body.memberships).toEqual([
            expect.objectContaining({
                club: { id: workspace.id, name: 'Клуб А' },
                role: 'user',
                status: 'ACTIVE',
            }),
        ])
        expect(res.body.journal.map((j: { body: string }) => j.body)).toEqual([
            'мой разбор',
        ])
        expect(res.body.consents).toHaveLength(1)
        expect(res.body.truncated).toEqual([])

        const audit = await ctx.prisma.auditEvent.findMany({
            where: { action: 'me.export', actorId: user.id },
        })
        expect(audit).toHaveLength(1)
    })

    it('is reachable before the consent is accepted', async () => {
        const { workspace } = await createWorkspace(ctx)
        const { user } = await addMember(ctx, { workspaceId: workspace.id })
        const actor = await signIn(ctx, user.email, { acceptConsent: false })

        const res = await ctx
            .http()
            .get('/me/export')
            .set(...actor.auth)
            .expect(200)
        expect(res.body.consents).toEqual([])
    })

    it('needs a signed-in user', async () => {
        await ctx.http().get('/me/export').expect(401)
    })
})
