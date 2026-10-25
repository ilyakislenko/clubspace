import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn } from '../support/actors'
import {
    addMember,
    createGroupWithSlot,
    createPlan,
    createWorkspace,
} from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// Coaches sell and manage abonements for the members of their own groups, and
// only those: the coach scope is resolved from GroupCoach against real Postgres.
describe('coach abonements', () => {
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
            dayOfWeek: 1,
        })
        const { group: groupB } = await createGroupWithSlot(ctx, {
            workspaceId: workspace.id,
            coachUserId: coachB.id,
            dayOfWeek: 2,
        })
        const { user: studentA } = await addMember(ctx, {
            workspaceId: workspace.id,
        })
        const { user: studentB } = await addMember(ctx, {
            workspaceId: workspace.id,
        })
        await ctx.prisma.groupMember.create({
            data: { groupId: groupA.id, userId: studentA.id },
        })
        await ctx.prisma.groupMember.create({
            data: { groupId: groupB.id, userId: studentB.id },
        })
        const plan = await createPlan(ctx, { workspaceId: workspace.id })
        const archived = await createPlan(ctx, {
            workspaceId: workspace.id,
            name: 'Архивный',
            isActive: false,
        })
        const ownerActor = await signIn(ctx, owner.email)
        const coachActor = await signIn(ctx, coachA.email)
        return {
            workspace,
            studentA,
            studentB,
            plan,
            archived,
            ownerActor,
            coachActor,
        }
    }

    const assign = (
        auth: [string, string],
        workspaceId: string,
        userId: string,
        body: Record<string, unknown>,
    ) =>
        ctx
            .http()
            .post(`/workspaces/${workspaceId}/members/${userId}/subscription`)
            .set(...auth)
            .send(body)

    it('lets the coach of the group sell an unpaid abonement and mark it paid', async () => {
        const { workspace, studentA, plan, coachActor } = await setup()

        const sold = await assign(coachActor.auth, workspace.id, studentA.id, {
            planId: plan.id,
            paid: false,
        })
        expect(sold.status).toBe(201)
        expect(sold.body.subscription).toMatchObject({ isPaid: false })

        const paid = await ctx
            .http()
            .post(
                `/workspaces/${workspace.id}/members/${studentA.id}/subscriptions/${sold.body.subscription.id}/payment`,
            )
            .set(...coachActor.auth)
            .send({})
        expect(paid.status).toBe(201)
        expect(paid.body.subscription.isPaid).toBe(true)

        const audit = await ctx.prisma.auditEvent.findFirstOrThrow({
            where: { action: 'member.assignSubscription' },
        })
        expect(audit.targetId).toBe(studentA.id)
        expect(audit.metadata).toMatchObject({ paid: false })
    })

    it('refuses a member of another group', async () => {
        const { workspace, studentB, plan, coachActor } = await setup()

        const res = await assign(coachActor.auth, workspace.id, studentB.id, {
            planId: plan.id,
        })
        expect(res.status).toBe(403)
        expect(await ctx.prisma.subscription.count()).toBe(0)
    })

    it('does not let a coach cancel an abonement', async () => {
        const { workspace, studentA, plan, ownerActor, coachActor } =
            await setup()
        const sold = await assign(ownerActor.auth, workspace.id, studentA.id, {
            planId: plan.id,
        })
        expect(sold.status).toBe(201)

        const res = await ctx
            .http()
            .post(
                `/workspaces/${workspace.id}/members/${studentA.id}/subscriptions/${sold.body.subscription.id}/cancel`,
            )
            .set(...coachActor.auth)
        expect(res.status).toBe(403)
        const row = await ctx.prisma.subscription.findFirstOrThrow({
            where: { id: sold.body.subscription.id },
        })
        expect(row.status).toBe('ACTIVE')
    })

    it('shows a coach the sellable plans only, an admin the archived ones too', async () => {
        const { workspace, plan, archived, ownerActor, coachActor } =
            await setup()

        const coachList = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/plans?includeInactive=true`)
            .set(...coachActor.auth)
        expect(coachList.status).toBe(200)
        expect(coachList.body.data.map((p: { id: string }) => p.id)).toEqual([
            plan.id,
        ])

        const adminList = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/plans?includeInactive=true`)
            .set(...ownerActor.auth)
        expect(
            adminList.body.data.map((p: { id: string }) => p.id).sort(),
        ).toEqual([plan.id, archived.id].sort())
    })

    it('reports what each caller may do with a member', async () => {
        const { workspace, studentA, ownerActor, coachActor } = await setup()
        const get = (auth: [string, string]) =>
            ctx
                .http()
                .get(`/workspaces/${workspace.id}/members/${studentA.id}/subscriptions`)
                .set(...auth)

        expect((await get(coachActor.auth)).body.permissions).toEqual({
            canManage: true,
            canCancel: false,
            canUnmarkPayment: false,
        })
        expect((await get(ownerActor.auth)).body.permissions).toEqual({
            canManage: true,
            canCancel: true,
            canUnmarkPayment: true,
        })
    })

    it('refuses a far-future start date from a coach, accepts it from an admin', async () => {
        const { workspace, studentA, plan, ownerActor, coachActor } =
            await setup()

        const refused = await assign(
            coachActor.auth,
            workspace.id,
            studentA.id,
            { planId: plan.id, startDate: '2099-01-01' },
        )
        expect(refused.status).toBe(400)
        expect(await ctx.prisma.subscription.count()).toBe(0)

        const allowed = await assign(
            ownerActor.auth,
            workspace.id,
            studentA.id,
            { planId: plan.id, startDate: '2099-01-01' },
        )
        expect(allowed.status).toBe(201)
    })

    it('refuses an archived tariff for a coach, accepts it from an admin', async () => {
        const { workspace, studentA, archived, ownerActor, coachActor } =
            await setup()

        const refused = await assign(
            coachActor.auth,
            workspace.id,
            studentA.id,
            { planId: archived.id },
        )
        expect(refused.status).toBe(400)
        expect(await ctx.prisma.subscription.count()).toBe(0)

        const allowed = await assign(
            ownerActor.auth,
            workspace.id,
            studentA.id,
            { planId: archived.id },
        )
        expect(allowed.status).toBe(201)
    })
})
