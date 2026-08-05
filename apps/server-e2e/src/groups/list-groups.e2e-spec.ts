import { signIn } from '../support/actors'
import { addMember, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'
import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'

describe('listing groups', () => {
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

    const setup = async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const ownerActor = await signIn(ctx, owner.email)
        return { workspace, ownerActor }
    }

    it('returns the club\'s groups', async () => {
        const { workspace, ownerActor } = await setup()

        const res = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/groups`)
            .set(...ownerActor.auth)
            .expect(200)

        expect(Array.isArray(res.body.data)).toBe(true)
    })

    // Found by the cross-club sweep: coachId went in as a bare string and
    // straight into a Prisma filter on a uuid column, so any malformed value
    // came back 500 — an unhandled PrismaClientKnownRequestError reported to
    // Sentry as a server fault. Anyone signed in could manufacture 5xx noise
    // and drown real incidents.
    it('rejects a malformed coachId with 400, not 500', async () => {
        const { workspace, ownerActor } = await setup()

        const res = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/groups?coachId=not-a-uuid`)
            .set(...ownerActor.auth)

        expect(res.status).toBe(400)
    })

    it('accepts a well-formed coachId that matches nobody', async () => {
        const { workspace, ownerActor } = await setup()

        const res = await ctx
            .http()
            .get(
                `/workspaces/${workspace.id}/groups?coachId=00000000-0000-4000-8000-000000000000`,
            )
            .set(...ownerActor.auth)
            .expect(200)

        expect(res.body.data).toEqual([])
    })

    it('treats an omitted coachId as no filter', async () => {
        const { workspace, ownerActor } = await setup()
        await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.COACH,
        })

        await ctx
            .http()
            .get(`/workspaces/${workspace.id}/groups`)
            .set(...ownerActor.auth)
            .expect(200)
    })
})
