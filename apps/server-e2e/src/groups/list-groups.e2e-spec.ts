import { signIn } from '../support/actors'
import {
    addMember,
    createGroupWithSlot,
    createPlan,
    createWorkspace,
} from '../support/fixtures'
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

    // The group page (GET /groups/:groupId): a coach of a club where coaches
    // see only their own groups gets their group and a 403 for another
    // coach's one; with coachSeesAllGroups the other group opens read-only.
    it('opens the group page to its coach and refuses another coach', async () => {
        const { workspace, ownerActor } = await setup()
        const { user: coachA } = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.COACH,
        })
        const { user: coachB } = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.COACH,
        })
        const { group: groupA } = await createGroupWithSlot(ctx, {
            workspaceId: workspace.id,
            coachUserId: coachA.id,
            dayOfWeek: 2,
        })
        const actorA = await signIn(ctx, coachA.email)
        const actorB = await signIn(ctx, coachB.email)
        const url = `/workspaces/${workspace.id}/groups/${groupA.id}`

        const own = await ctx.http().get(url).set(...actorA.auth).expect(200)
        expect(own.body).toMatchObject({ id: groupA.id, canEdit: true })
        expect(own.body.slots).toHaveLength(1)

        await ctx.http().get(url).set(...actorB.auth).expect(403)

        await ctx.prisma.workspace.update({
            where: { id: workspace.id },
            data: { coachSeesAllGroups: true },
        })
        const readOnly = await ctx.http().get(url).set(...actorB.auth).expect(200)
        expect(readOnly.body.canEdit).toBe(false)

        const asOwner = await ctx.http().get(url).set(...ownerActor.auth).expect(200)
        expect(asOwner.body.canEdit).toBe(true)

        await ctx
            .http()
            .get(`/workspaces/${workspace.id}/groups/00000000-0000-4000-8000-000000000000`)
            .set(...ownerActor.auth)
            .expect(404)
    })

    // The tariff page (GET /plans/:planId): holders and sales are the
    // admin's (or the direction manager's) — a plain coach is refused.
    it('opens the tariff page to the owner and refuses a coach', async () => {
        const { workspace, ownerActor } = await setup()
        const { user: coach } = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.COACH,
        })
        const plan = await createPlan(ctx, { workspaceId: workspace.id })
        const url = `/workspaces/${workspace.id}/plans/${plan.id}`

        const res = await ctx.http().get(url).set(...ownerActor.auth).expect(200)
        expect(res.body).toMatchObject({
            plan: { id: plan.id, name: plan.name },
            holders: [],
            last30Days: { sold: 0, revenue: 0 },
        })

        const coachActor = await signIn(ctx, coach.email)
        await ctx.http().get(url).set(...coachActor.auth).expect(403)
    })
})
