import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'import { signIn } from '../support/actors'
import { addMember, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// Ownership is Workspace.ownerId. A WorkspaceMember row is a separate record
// that the platform console happens to create when it hands a club over — but
// nothing in the schema ties the two together, and every membership gate is
// written on the assumption that an owner might not have one.
//
// AuthGuard was the exception. It resolved the caller's role by looking up the
// membership, and an owner without that row was refused with "Вы не участник
// этого клуба" on their own club — before WorkspaceMemberGuard's owner bypass
// ever ran, so the bypass was dead code for the case it was written for.
describe('club owner access', () => {
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

    it('lets an owner who holds no membership row manage their club', async () => {
        const { workspace, owner } = await createWorkspace(ctx, {
            ownerMembership: false,
        })
        await addMember(ctx, { workspaceId: workspace.id })
        const actor = await signIn(ctx, owner.email)

        // Not a platform admin — this must work on club ownership alone.
        expect(
            (await ctx.prisma.user.findUniqueOrThrow({ where: { id: owner.id } }))
                .isSuperAdmin,
        ).toBe(false)

        await ctx
            .http()
            .get(`/workspaces/${workspace.id}/members`)
            .set(...actor.auth)
            .expect(200)
    })

    it('lets an owner who does hold a membership row manage their club', async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const actor = await signIn(ctx, owner.email)

        await ctx
            .http()
            .get(`/workspaces/${workspace.id}/members`)
            .set(...actor.auth)
            .expect(200)
    })

    // The owner fallback resolves the real 'admin' role, so it must not become
    // a way into somebody else's club.
    // AuthGuard takes the role from the member row first; an owner whose row
    // says coach (promoted before ownership transfer raised roles) must still
    // reach WORKSPACE_ADMINS routes of their own club.
    it('lets an owner whose membership row is a coach use admin-only routes', async () => {
        const { workspace, owner } = await createWorkspace(ctx, {
            ownerMembership: false,
        })
        await addMember(ctx, {
            workspaceId: workspace.id,
            userId: owner.id,
            role: RolesEnum.COACH,
        })
        const actor = await signIn(ctx, owner.email)

        await ctx
            .http()
            .get(`/workspaces/${workspace.id}/plans`)
            .set(...actor.auth)
            .expect(200)
    })

    it('does not let a non-owner without a membership row in', async () => {
        const { workspace } = await createWorkspace(ctx)
        const stranger = await createWorkspace(ctx, { ownerMembership: false })
        const actor = await signIn(ctx, stranger.owner.email)

        const res = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/members`)
            .set(...actor.auth)

        expect(res.status).toBe(403)
    })

    it('still refuses a plain member on an admin-only route', async () => {
        const { workspace } = await createWorkspace(ctx)
        const { user } = await addMember(ctx, { workspaceId: workspace.id })
        const actor = await signIn(ctx, user.email)

        const res = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/members`)
            .set(...actor.auth)

        expect(res.status).toBe(403)
    })

    it('lets the platform admin into a club they never joined', async () => {
        const { workspace } = await createWorkspace(ctx)
        // Seeded from SUPER_ADMIN_EMAIL on bootstrap.
        const actor = await signIn(ctx, 'platform-owner@clubspace.test')

        await ctx
            .http()
            .get(`/workspaces/${workspace.id}/members`)
            .set(...actor.auth)
            .expect(200)
    })
})
