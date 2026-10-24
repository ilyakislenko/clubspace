import { FirstVisitPendingService } from '../../../server/src/domains/subscriptions/services/first-visit-pending.service'
import { signIn } from '../support/actors'
import { addMember, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const DAY = 24 * 3600_000
const MSK = 3 * 3600_000 // Europe/Moscow, the default club timezone: UTC+3, no DST

// The club-local midnight of the day containing `at`.
const clubMidnight = (at: Date) =>
    new Date(Math.floor((at.getTime() + MSK) / DAY) * DAY - MSK)

// «Срок считается с первой тренировки»: the sold abonement has no dates until
// the first visit is recorded, and the start is re-derived from the data on
// every mark / un-mark / self-check-in. These run against real Postgres because
// the nullable startDate, the compare-and-set and the visit query are exactly
// what a jest.fn() cannot prove.
describe('abonement that starts at the first visit', () => {
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

    const setup = async (
        plan: { classCount?: number | null; startsOnFirstVisit?: boolean } = {},
    ) => {
        const { workspace, owner } = await createWorkspace(ctx)
        const { user: memberUser } = await addMember(ctx, {
            workspaceId: workspace.id,
        })
        const created = await createPlan(ctx, {
            workspaceId: workspace.id,
            durationDays: 30,
            classCount: plan.classCount ?? null,
            startsOnFirstVisit: plan.startsOnFirstVisit ?? true,
        })
        const ownerActor = await signIn(ctx, owner.email)
        const memberActor = await signIn(ctx, memberUser.email)
        return { workspace, owner, ownerActor, memberUser, memberActor, plan: created }
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

    let n = 0
    const createSession = (
        workspaceId: string,
        createdById: string,
        over: { startAt?: Date; checkInCode?: string } = {},
    ) =>
        ctx.prisma.attendanceSession.create({
            data: {
                workspaceId,
                occurrenceKey: `adhoc:first-visit-${++n}`,
                title: 'Вечерняя',
                startAt: over.startAt ?? new Date(),
                timezone: 'Europe/Moscow',
                checkInCode: over.checkInCode ?? null,
                createdById,
            },
        })

    const mark = (
        auth: [string, string],
        workspaceId: string,
        sessionId: string,
        userId: string,
    ) =>
        ctx
            .http()
            .post(`/workspaces/${workspaceId}/attendance/sessions/${sessionId}/records`)
            .set(...auth)
            .send({ userIds: [userId] })

    const unmark = (
        auth: [string, string],
        workspaceId: string,
        sessionId: string,
        userId: string,
    ) =>
        ctx
            .http()
            .delete(
                `/workspaces/${workspaceId}/attendance/sessions/${sessionId}/records/${userId}`,
            )
            .set(...auth)

    const state = async (workspaceId: string, userId: string) => {
        const member = await ctx.prisma.workspaceMember.findFirstOrThrow({
            where: { workspaceId, userId },
            include: { subscription: true },
        })
        return { sub: member.subscription!, accessUntil: member.accessUntil }
    }

    it('assigning waits for the first visit and opens provisional access', async () => {
        const { workspace, ownerActor, memberUser } = await setup()
        const res = await assign(ownerActor.auth, workspace.id, memberUser.id, {
            planId: (await ctx.prisma.plan.findFirstOrThrow()).id,
        })
        expect(res.status).toBe(201)
        expect(res.body.subscription).toMatchObject({
            startDate: null,
            endDate: null,
            startsOnFirstVisit: true,
            durationDays: 30,
        })

        // Provisional access: the latest auto-start (14 days) + the term.
        const expected = new Date(clubMidnight(new Date()).getTime() + 44 * DAY)
        expect(res.body.accessUntil).toBe(expected.toISOString())
        const { sub, accessUntil } = await state(workspace.id, memberUser.id)
        expect(sub.startDate).toBeNull()
        expect(accessUntil).toEqual(expected)
    })

    it('marking the member starts it on the club-local day, un-marking takes it back', async () => {
        const { workspace, owner, ownerActor, memberUser, plan } = await setup()
        await assign(ownerActor.auth, workspace.id, memberUser.id, {
            planId: plan.id,
        }).expect(201)
        const session = await createSession(workspace.id, owner.id)

        await mark(ownerActor.auth, workspace.id, session.id, memberUser.id).expect(
            201,
        )
        const start = clubMidnight(session.startAt)
        const started = await state(workspace.id, memberUser.id)
        expect(started.sub.startDate).toEqual(start)
        expect(started.sub.endDate).toEqual(new Date(start.getTime() + 30 * DAY))
        expect(started.accessUntil).toEqual(started.sub.endDate)

        await unmark(
            ownerActor.auth,
            workspace.id,
            session.id,
            memberUser.id,
        ).expect(200)
        const back = await state(workspace.id, memberUser.id)
        expect(back.sub.startDate).toBeNull()
        expect(back.sub.endDate).toBeNull()
        expect(back.accessUntil).toEqual(
            new Date(clubMidnight(new Date()).getTime() + 44 * DAY),
        )
    })

    it('starts by itself 14 days after the sale when nobody came (daily pass)', async () => {
        const { workspace, ownerActor, memberUser, plan } = await setup()
        await assign(ownerActor.auth, workspace.id, memberUser.id, {
            planId: plan.id,
        }).expect(201)
        const before = await state(workspace.id, memberUser.id)
        const service = ctx.app.get(FirstVisitPendingService, { strict: false })

        // Day 13: still waiting.
        const early = new Date(Date.now() + 13 * DAY)
        expect((await service.run(early)).autoStarted).toBe(0)
        expect((await state(workspace.id, memberUser.id)).sub.startDate).toBeNull()

        // Day 15: started on the deadline day, access unchanged (it was already
        // deadline + term).
        const late = new Date(Date.now() + 15 * DAY)
        expect((await service.run(late)).autoStarted).toBe(1)
        const deadline = new Date(clubMidnight(before.sub.createdAt).getTime() + 14 * DAY)
        const started = await state(workspace.id, memberUser.id)
        expect(started.sub.startDate).toEqual(deadline)
        expect(started.sub.endDate).toEqual(new Date(deadline.getTime() + 30 * DAY))
        expect(started.accessUntil).toEqual(before.accessUntil)

        // Idempotent.
        expect((await service.run(late)).autoStarted).toBe(0)
    })

    it('a visit after the deadline loses to the auto-start', async () => {
        const { workspace, owner, ownerActor, memberUser, plan } = await setup()
        await assign(ownerActor.auth, workspace.id, memberUser.id, {
            planId: plan.id,
        }).expect(201)
        // The sale was 20 days ago; the first mark happens only now.
        const soldAt = new Date(Date.now() - 20 * DAY)
        await ctx.prisma.subscription.updateMany({ data: { createdAt: soldAt } })
        const session = await createSession(workspace.id, owner.id)
        await mark(ownerActor.auth, workspace.id, session.id, memberUser.id).expect(201)

        const { sub } = await state(workspace.id, memberUser.id)
        expect(sub.startDate).toEqual(new Date(clubMidnight(soldAt).getTime() + 14 * DAY))
    })

    it('reminds a member who has not come on sale day + 3, once', async () => {
        const { workspace, ownerActor, memberUser, plan } = await setup()
        await assign(ownerActor.auth, workspace.id, memberUser.id, {
            planId: plan.id,
        }).expect(201)
        const service = ctx.app.get(FirstVisitPendingService, { strict: false })
        // 12:00 club time (UTC+3) on sale day + 3.
        const noon = new Date(clubMidnight(new Date()).getTime() + 3 * DAY + 12 * 3600_000)

        expect((await service.run(noon)).reminded).toBe(1)
        expect((await service.run(noon)).reminded).toBe(0)
        const rows = await ctx.prisma.notification.findMany({
            where: { userId: memberUser.id },
        })
        expect(
            rows.filter(
                (r) =>
                    (r.metadata as { kind?: string } | null)?.kind ===
                    'subscription.first_visit_pending',
            ),
        ).toHaveLength(1)
    })

    it('refuses to freeze an abonement that has not started', async () => {
        const { workspace, ownerActor, memberUser, plan } = await setup()
        await assign(ownerActor.auth, workspace.id, memberUser.id, {
            planId: plan.id,
        }).expect(201)
        const sub = await ctx.prisma.subscription.findFirstOrThrow({
            where: { workspaceId: workspace.id },
        })

        const res = await ctx
            .http()
            .post(
                `/workspaces/${workspace.id}/members/${memberUser.id}/subscriptions/${sub.id}/freezes`,
            )
            .set(...ownerActor.auth)
            .send({ days: 7 })
        expect(res.status).toBe(400)
        expect(res.body.message).toMatch(/ещё не начался/)
        expect(await ctx.prisma.subscriptionFreeze.count()).toBe(0)
    })

    it('a self-check-in by code starts it', async () => {
        const { workspace, owner, ownerActor, memberActor, memberUser, plan } =
            await setup()
        await assign(ownerActor.auth, workspace.id, memberUser.id, {
            planId: plan.id,
        }).expect(201)
        await createSession(workspace.id, owner.id, { checkInCode: 'ABC234' })

        await ctx
            .http()
            .post(`/workspaces/${workspace.id}/attendance/check-in`)
            .set(...memberActor.auth)
            .send({ code: 'ABC234' })
            .expect(201)

        const { sub } = await state(workspace.id, memberUser.id)
        expect(sub.startDate).toEqual(clubMidnight(new Date()))
        expect(sub.endDate).toEqual(new Date(clubMidnight(new Date()).getTime() + 30 * DAY))
    })

    it('a back-to-back renewal dated on the day the old one ends is allowed', async () => {
        const { workspace, ownerActor, memberUser, plan } = await setup({
            startsOnFirstVisit: false,
        })
        await assign(ownerActor.auth, workspace.id, memberUser.id, {
            planId: plan.id,
        }).expect(201)
        // The old row ends at 00:00 UTC tomorrow — 03:00 club time, i.e. after
        // the club midnight the renewal starts on, though on the same club day.
        const tomorrow = new Date(clubMidnight(new Date()).getTime() + DAY + MSK)
            .toISOString()
            .slice(0, 10)
        await ctx.prisma.subscription.updateMany({
            data: { endDate: new Date(`${tomorrow}T00:00:00Z`) },
        })

        await assign(ownerActor.auth, workspace.id, memberUser.id, {
            planId: plan.id,
            startDate: tomorrow,
        }).expect(201)
        expect(await ctx.prisma.subscription.count()).toBe(2)
    })

    it('a 2-class pack used up by two marks no longer blocks a new sale', async () => {
        const { workspace, owner, ownerActor, memberUser } = await setup({
            classCount: 2,
            startsOnFirstVisit: false,
        })
        const pack = await ctx.prisma.plan.findFirstOrThrow()
        await assign(ownerActor.auth, workspace.id, memberUser.id, {
            planId: pack.id,
        }).expect(201)
        const first = await createSession(workspace.id, owner.id)
        const second = await createSession(workspace.id, owner.id)
        await mark(ownerActor.auth, workspace.id, first.id, memberUser.id).expect(201)
        await mark(ownerActor.auth, workspace.id, second.id, memberUser.id).expect(201)
        const old = await ctx.prisma.subscription.findFirstOrThrow({
            where: { workspaceId: workspace.id },
        })
        expect(old.classesRemaining).toBe(0)

        await assign(ownerActor.auth, workspace.id, memberUser.id, {
            planId: pack.id,
        }).expect(201)

        expect(
            (await ctx.prisma.subscription.findUniqueOrThrow({ where: { id: old.id } }))
                .status,
        ).toBe('EXPIRED')
        const current = await state(workspace.id, memberUser.id)
        expect(current.sub.id).not.toBe(old.id)
        expect(current.sub.status).toBe('ACTIVE')
    })
})
