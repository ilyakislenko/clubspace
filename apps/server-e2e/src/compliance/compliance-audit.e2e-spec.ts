import { signIn } from '../support/actors'
import { createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// Bulk personal data leaving a club, and a platform admin looking inside one,
// both leave an entry in that club's journal.
describe('compliance audit trail', () => {
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

    // The platform-access entry is written off the request path.
    const waitForAudit = async (where: { action: string; workspaceId: string }) => {
        for (let i = 0; i < 40; i++) {
            const rows = await ctx.prisma.auditEvent.findMany({ where })
            if (rows.length > 0) return rows
            await new Promise((r) => setTimeout(r, 50))
        }
        return []
    }

    it('journals a club CSV export in that club', async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const actor = await signIn(ctx, owner.email)

        await ctx
            .http()
            .get(`/workspaces/${workspace.id}/exports/members.csv`)
            .set(...actor.auth)
            .expect(200)

        const rows = await ctx.prisma.auditEvent.findMany({
            where: { action: 'export.members', workspaceId: workspace.id },
        })
        expect(rows).toHaveLength(1)
        expect(rows[0].actorId).toBe(owner.id)
    })

    it('journals a platform admin opening a club they do not belong to, once', async () => {
        const { workspace } = await createWorkspace(ctx)
        const admin = await signIn(ctx, 'platform-owner@clubspace.test')

        for (let i = 0; i < 3; i++) {
            await ctx
                .http()
                .get(`/workspaces/${workspace.id}/about`)
                .set(...admin.auth)
                .expect(200)
        }

        const rows = await waitForAudit({
            action: 'platform.accessClub',
            workspaceId: workspace.id,
        })
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({
            actorId: admin.userId,
            targetType: 'workspace',
            metadata: {
                method: 'GET',
                route: '/workspaces/:workspaceId/about',
            },
        })
    })
})
