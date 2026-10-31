import { signIn } from '../support/actors'
import { addMember, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// A coach marking the roster and the member checking in by code at the same
// moment both insert the same (session, member) record. Only the request whose
// insert actually created the row may draw a class; the other must lose on the
// unique index and charge nothing. Proved against real Postgres because the
// race lives in the database, not in the handler.
describe('class pack under concurrent check-ins', () => {
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
        const { user: memberUser } = await addMember(ctx, {
            workspaceId: workspace.id,
        })
        const plan = await createPlan(ctx, {
            workspaceId: workspace.id,
            durationDays: 30,
            classCount: 5,
            startsOnFirstVisit: false,
        })
        const ownerActor = await signIn(ctx, owner.email)
        const memberActor = await signIn(ctx, memberUser.email)
        await ctx
            .http()
            .post(
                `/workspaces/${workspace.id}/members/${memberUser.id}/subscription`,
            )
            .set(...ownerActor.auth)
            .send({ planId: plan.id })
            .expect(201)
        return { workspace, owner, ownerActor, memberUser, memberActor }
    }

    let n = 0
    const createSession = (workspaceId: string, createdById: string) =>
        ctx.prisma.attendanceSession.create({
            data: {
                workspaceId,
                occurrenceKey: `adhoc:race-${++n}`,
                title: 'Вечерняя',
                startAt: new Date(),
                timezone: 'Europe/Moscow',
                checkInCode: `RACE${n}Z`,
                createdById,
            },
        })

    const remaining = async (workspaceId: string) =>
        (
            await ctx.prisma.subscription.findFirstOrThrow({
                where: { workspaceId },
            })
        ).classesRemaining

    it('charges one class when the coach marks and the member self-checks-in at once', async () => {
        const { workspace, owner, ownerActor, memberUser, memberActor } =
            await setup()
        expect(await remaining(workspace.id)).toBe(5)

        // Several rounds: a single round can serialize by luck.
        for (let round = 1; round <= 5; round++) {
            const session = await createSession(workspace.id, owner.id)
            const [marked, checkedIn] = await Promise.all([
                ctx
                    .http()
                    .post(
                        `/workspaces/${workspace.id}/attendance/sessions/${session.id}/records`,
                    )
                    .set(...ownerActor.auth)
                    .send({ userIds: [memberUser.id] }),
                ctx
                    .http()
                    .post(`/workspaces/${workspace.id}/attendance/check-in`)
                    .set(...memberActor.auth)
                    .send({ code: session.checkInCode }),
            ])
            expect(marked.status).toBe(201)
            expect(checkedIn.status).toBe(201)

            expect(await remaining(workspace.id)).toBe(5 - round)
            const records = await ctx.prisma.attendanceRecord.findMany({
                where: { sessionId: session.id },
            })
            expect(records).toHaveLength(1)
            // Tagged with the pack exactly once, so an un-mark refunds one.
            expect(records[0].consumedSubscriptionId).not.toBeNull()
        }
    })

    it('charges one class when two coaches mark the same member at once', async () => {
        const { workspace, owner, ownerActor, memberUser } = await setup()
        const session = await createSession(workspace.id, owner.id)
        const mark = () =>
            ctx
                .http()
                .post(
                    `/workspaces/${workspace.id}/attendance/sessions/${session.id}/records`,
                )
                .set(...ownerActor.auth)
                .send({ userIds: [memberUser.id] })
        const results = await Promise.all([mark(), mark(), mark()])
        expect(results.map((r) => r.status)).toEqual([201, 201, 201])
        expect(await remaining(workspace.id)).toBe(4)
    })
})
