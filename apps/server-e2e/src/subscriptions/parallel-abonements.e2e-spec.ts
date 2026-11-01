import { signIn, type Actor } from '../support/actors'
import { addMember, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// Several current abonements per member and tariffs scoped to a SET of
// directions, against the real guards, handlers and database: which abonement
// each visit is spent on (visit precedence), freezes of one not blocking the
// other, the coach's choice, self check-in, and that none of it leaks across
// clubs (docs/design/2026-11-01-directions.md).
describe('parallel abonements', () => {
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

    const ws = (workspaceId: string) => `/workspaces/${workspaceId}`

    const createDirection = async (workspaceId: string, actor: Actor, name: string) => {
        const res = await ctx
            .http()
            .post(`${ws(workspaceId)}/directions`)
            .set(...actor.auth)
            .send({ name })
            .expect(201)
        return res.body as { id: string; name: string }
    }

    const createGroup = (
        workspaceId: string,
        coachId: string,
        name: string,
        directionId: string | null,
        memberIds: string[],
    ) =>
        ctx.prisma.group.create({
            data: {
                workspaceId,
                name,
                coachId,
                directionId,
                coaches: { create: { userId: coachId, role: 'primary' } },
                members: { create: memberIds.map((userId) => ({ userId })) },
            },
        })

    let n = 0
    const sessionFor = (workspaceId: string, groupId: string | null, createdById: string) => {
        n++
        return ctx.prisma.attendanceSession.create({
            data: {
                workspaceId,
                groupId,
                occurrenceKey: `adhoc:${groupId ?? 'none'}:${n}`,
                title: 'Тренировка',
                startAt: new Date(),
                timezone: 'Europe/Moscow',
                checkInCode: `PAR${n}Z`,
                createdById,
            },
        })
    }

    const createPlanVia = async (
        workspaceId: string,
        actor: Actor,
        name: string,
        directionIds: string[],
        classCount: number | null = 12,
    ) => {
        const res = await ctx
            .http()
            .post(`${ws(workspaceId)}/plans`)
            .set(...actor.auth)
            .send({ name, price: 6000, currency: 'RUB', durationDays: 30, classCount, directionIds })
            .expect(201)
        return res.body as { id: string; directions: Array<{ id: string }> }
    }

    const sell = (workspaceId: string, actor: Actor, userId: string, planId: string) =>
        ctx
            .http()
            .post(`${ws(workspaceId)}/members/${userId}/subscription`)
            .set(...actor.auth)
            .send({ planId })

    const mark = (
        workspaceId: string,
        sessionId: string,
        actor: Actor,
        userIds: string[],
        abonements?: Array<{ userId: string; subscriptionId: string }>,
    ) =>
        ctx
            .http()
            .post(`${ws(workspaceId)}/attendance/sessions/${sessionId}/records`)
            .set(...actor.auth)
            .send(abonements ? { userIds, abonements } : { userIds })

    const left = async (subscriptionId: string) =>
        (await ctx.prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } }))
            .classesRemaining

    const record = (sessionId: string, userId: string) =>
        ctx.prisma.attendanceRecord.findUniqueOrThrow({
            where: { sessionId_userId: { sessionId, userId } },
        })

    // A club with БЖЖ, ММА and тайский бокс groups; `student` trains in all three.
    const setup = async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const { user: student } = await addMember(ctx, { workspaceId: workspace.id })
        const ownerActor = await signIn(ctx, owner.email)
        const studentActor = await signIn(ctx, student.email)
        const bjj = await createDirection(workspace.id, ownerActor, 'БЖЖ')
        const mma = await createDirection(workspace.id, ownerActor, 'ММА')
        const mt = await createDirection(workspace.id, ownerActor, 'Тайский бокс')
        const bjjGroup = await createGroup(workspace.id, owner.id, 'БЖЖ', bjj.id, [student.id])
        const mmaGroup = await createGroup(workspace.id, owner.id, 'ММА', mma.id, [student.id])
        const mtGroup = await createGroup(workspace.id, owner.id, 'Тай', mt.id, [student.id])
        return {
            workspace,
            owner,
            ownerActor,
            student,
            studentActor,
            bjj,
            mma,
            mt,
            bjjGroup,
            mmaGroup,
            mtGroup,
        }
    }

    it('«БЖЖ + ММА» is drawn by БЖЖ and ММА classes but not by тайский бокс', async () => {
        const s = await setup()
        const plan = await createPlanVia(s.workspace.id, s.ownerActor, 'БЖЖ + ММА 12', [
            s.bjj.id,
            s.mma.id,
        ])
        expect(plan.directions.map((d) => d.id).sort()).toEqual([s.bjj.id, s.mma.id].sort())
        const sold = await sell(s.workspace.id, s.ownerActor, s.student.id, plan.id).expect(201)
        const subId = sold.body.subscription.id as string
        expect(sold.body.subscription.directions).toHaveLength(2)

        const bjjSession = await sessionFor(s.workspace.id, s.bjjGroup.id, s.owner.id)
        await mark(s.workspace.id, bjjSession.id, s.ownerActor, [s.student.id]).expect(201)
        expect(await left(subId)).toBe(11)

        const mmaSession = await sessionFor(s.workspace.id, s.mmaGroup.id, s.owner.id)
        await mark(s.workspace.id, mmaSession.id, s.ownerActor, [s.student.id]).expect(201)
        expect(await left(subId)).toBe(10)

        const mtSession = await sessionFor(s.workspace.id, s.mtGroup.id, s.owner.id)
        await mark(s.workspace.id, mtSession.id, s.ownerActor, [s.student.id]).expect(201)
        expect(await left(subId)).toBe(10)
        // The visit is still recorded, just not spent on anything.
        expect(await record(mtSession.id, s.student.id)).toMatchObject({
            usedSubscriptionId: null,
            consumedSubscriptionId: null,
        })

        // Editing the tariff never changes what was bought.
        await ctx
            .http()
            .patch(`${ws(s.workspace.id)}/plans/${plan.id}`)
            .set(...s.ownerActor.auth)
            .send({ directionIds: [s.mt.id] })
            .expect(200)
        const mt2 = await sessionFor(s.workspace.id, s.mtGroup.id, s.owner.id)
        await mark(s.workspace.id, mt2.id, s.ownerActor, [s.student.id]).expect(201)
        expect(await left(subId)).toBe(10)
    })

    it('with a БЖЖ pack and a club-wide pack, a БЖЖ class draws the БЖЖ one; the coach can pick the other', async () => {
        const s = await setup()
        const bjjPlan = await createPlanVia(s.workspace.id, s.ownerActor, 'БЖЖ 12', [s.bjj.id])
        const clubPlan = await createPlanVia(s.workspace.id, s.ownerActor, 'Клуб 8', [], 8)
        const clubSub = (await sell(s.workspace.id, s.ownerActor, s.student.id, clubPlan.id).expect(201))
            .body.subscription.id as string
        // A second abonement with a different set is allowed…
        const bjjSub = (await sell(s.workspace.id, s.ownerActor, s.student.id, bjjPlan.id).expect(201))
            .body.subscription.id as string
        // …a second one with the same set is not (unchanged one-live-abonement rule).
        const again = await sell(s.workspace.id, s.ownerActor, s.student.id, bjjPlan.id).expect(400)
        expect(again.body.message).toMatch(/осталось 12/)

        const bjjSession = await sessionFor(s.workspace.id, s.bjjGroup.id, s.owner.id)
        const roster = await ctx
            .http()
            .get(`${ws(s.workspace.id)}/attendance/sessions/${bjjSession.id}/roster`)
            .set(...s.ownerActor.auth)
            .expect(200)
        const entry = roster.body.roster.find((e: { userId: string }) => e.userId === s.student.id)
        expect(entry.abonement.subscriptionId).toBe(bjjSub)
        expect(entry.abonementOptions.map((o: { subscriptionId: string }) => o.subscriptionId)).toEqual([
            bjjSub,
            clubSub,
        ])

        await mark(s.workspace.id, bjjSession.id, s.ownerActor, [s.student.id]).expect(201)
        expect(await left(bjjSub)).toBe(11)
        expect(await left(clubSub)).toBe(8)
        expect(await record(bjjSession.id, s.student.id)).toMatchObject({
            usedSubscriptionId: bjjSub,
            consumedSubscriptionId: bjjSub,
        })

        // Тайский бокс: only the club-wide pack matches.
        const mtSession = await sessionFor(s.workspace.id, s.mtGroup.id, s.owner.id)
        await mark(s.workspace.id, mtSession.id, s.ownerActor, [s.student.id]).expect(201)
        expect(await left(clubSub)).toBe(7)

        // The coach picks the club-wide pack for a БЖЖ class.
        const picked = await sessionFor(s.workspace.id, s.bjjGroup.id, s.owner.id)
        await mark(s.workspace.id, picked.id, s.ownerActor, [s.student.id], [
            { userId: s.student.id, subscriptionId: clubSub },
        ]).expect(201)
        expect(await left(clubSub)).toBe(6)
        expect(await left(bjjSub)).toBe(11)

        // …and moves the first БЖЖ visit over to the club-wide pack: refund + deduction.
        await ctx
            .http()
            .put(
                `${ws(s.workspace.id)}/attendance/sessions/${bjjSession.id}/records/${s.student.id}/abonement`,
            )
            .set(...s.ownerActor.auth)
            .send({ subscriptionId: clubSub })
            .expect(200)
        expect(await left(bjjSub)).toBe(12)
        expect(await left(clubSub)).toBe(5)
        expect(await record(bjjSession.id, s.student.id)).toMatchObject({
            usedSubscriptionId: clubSub,
            consumedSubscriptionId: clubSub,
        })

        // A pack that does not cover the class can't be picked.
        const mt2 = await sessionFor(s.workspace.id, s.mtGroup.id, s.owner.id)
        const refused = await mark(s.workspace.id, mt2.id, s.ownerActor, [s.student.id], [
            { userId: s.student.id, subscriptionId: bjjSub },
        ]).expect(400)
        expect(refused.body.message).toBe('Этот абонемент нельзя списать на эту тренировку')
        expect(await ctx.prisma.attendanceRecord.count({ where: { sessionId: mt2.id } })).toBe(0)

        // Both are listed for the member and for the admin, with their directions.
        const mine = await ctx
            .http()
            .get(`${ws(s.workspace.id)}/me/subscription`)
            .set(...s.studentActor.auth)
            .expect(200)
        expect(
            mine.body.abonements.map((a: { id: string; directions: unknown[] }) => [a.id, a.directions.length]),
        ).toEqual(
            expect.arrayContaining([
                [bjjSub, 1],
                [clubSub, 0],
            ]),
        )
        expect(mine.body.abonements).toHaveLength(2)
        const panel = await ctx
            .http()
            .get(`${ws(s.workspace.id)}/members/${s.student.id}/subscriptions`)
            .set(...s.ownerActor.auth)
            .expect(200)
        expect(panel.body.abonements).toHaveLength(2)
    })

    it('freezing one pack does not block the other; check-in passes when any matching pack is live', async () => {
        const s = await setup()
        const bjjPlan = await createPlanVia(s.workspace.id, s.ownerActor, 'БЖЖ 12', [s.bjj.id])
        const clubPlan = await createPlanVia(s.workspace.id, s.ownerActor, 'Клуб 8', [], 8)
        const bjjSub = (await sell(s.workspace.id, s.ownerActor, s.student.id, bjjPlan.id).expect(201))
            .body.subscription.id as string
        const clubSub = (await sell(s.workspace.id, s.ownerActor, s.student.id, clubPlan.id).expect(201))
            .body.subscription.id as string

        await ctx
            .http()
            .post(`${ws(s.workspace.id)}/members/${s.student.id}/subscriptions/${bjjSub}/freezes`)
            .set(...s.ownerActor.auth)
            .send({ days: 7 })
            .expect(201)

        // Self check-in to a БЖЖ class: the frozen БЖЖ pack is skipped, the club-wide one pays.
        const bjjSession = await sessionFor(s.workspace.id, s.bjjGroup.id, s.owner.id)
        const preview = await ctx
            .http()
            .post(`${ws(s.workspace.id)}/attendance/check-in/preview`)
            .set(...s.studentActor.auth)
            .send({ code: bjjSession.checkInCode })
        expect(preview.status).toBeLessThan(300)
        expect(preview.body.abonement.subscriptionId).toBe(clubSub)
        expect(preview.body.abonementOptions).toHaveLength(1)
        expect(await ctx.prisma.attendanceRecord.count({ where: { sessionId: bjjSession.id } })).toBe(0)

        const checkedIn = await ctx
            .http()
            .post(`${ws(s.workspace.id)}/attendance/check-in`)
            .set(...s.studentActor.auth)
            .send({ code: bjjSession.checkInCode })
            .expect(201)
        expect(checkedIn.body).toMatchObject({ checkedIn: true, classesRemaining: 7 })
        expect(checkedIn.body.abonement.subscriptionId).toBe(clubSub)
        expect(await left(bjjSub)).toBe(12)

        // Freezing the club-wide pack too: nothing eligible left → refused like before.
        await ctx
            .http()
            .post(`${ws(s.workspace.id)}/members/${s.student.id}/subscriptions/${clubSub}/freezes`)
            .set(...s.ownerActor.auth)
            .send({ days: 7 })
            .expect(201)
        const next = await sessionFor(s.workspace.id, s.bjjGroup.id, s.owner.id)
        const refused = await ctx
            .http()
            .post(`${ws(s.workspace.id)}/attendance/check-in`)
            .set(...s.studentActor.auth)
            .send({ code: next.checkInCode })
            .expect(400)
        expect(refused.body.message).toMatch(/заморожен/)
    })

    it('a class without a direction draws only a club-wide abonement; a time-based one counts without deducting', async () => {
        const s = await setup()
        const bjjPlan = await createPlanVia(s.workspace.id, s.ownerActor, 'БЖЖ 12', [s.bjj.id])
        const unlimited = await createPlanVia(s.workspace.id, s.ownerActor, 'Безлимит', [], null)
        const bjjSub = (await sell(s.workspace.id, s.ownerActor, s.student.id, bjjPlan.id).expect(201))
            .body.subscription.id as string
        const unlimitedSub = (await sell(s.workspace.id, s.ownerActor, s.student.id, unlimited.id).expect(201))
            .body.subscription.id as string

        const plainGroup = await createGroup(s.workspace.id, s.owner.id, 'ОФП', null, [s.student.id])
        const plain = await sessionFor(s.workspace.id, plainGroup.id, s.owner.id)
        await mark(s.workspace.id, plain.id, s.ownerActor, [s.student.id]).expect(201)
        expect(await left(bjjSub)).toBe(12)
        expect(await record(plain.id, s.student.id)).toMatchObject({
            usedSubscriptionId: unlimitedSub,
            consumedSubscriptionId: null,
        })
    })

    it('another club can neither move a visit, preview a check-in nor spend a foreign abonement', async () => {
        const s = await setup()
        const plan = await createPlanVia(s.workspace.id, s.ownerActor, 'Клуб 8', [], 8)
        const subId = (await sell(s.workspace.id, s.ownerActor, s.student.id, plan.id).expect(201))
            .body.subscription.id as string
        const session = await sessionFor(s.workspace.id, s.bjjGroup.id, s.owner.id)
        await mark(s.workspace.id, session.id, s.ownerActor, [s.student.id]).expect(201)

        const { workspace: other, owner: otherOwner } = await createWorkspace(ctx)
        const otherActor = await signIn(ctx, otherOwner.email)
        const { user: otherStudent } = await addMember(ctx, { workspaceId: other.id })
        const otherStudentActor = await signIn(ctx, otherStudent.email)

        // Foreign club in the path: the guards refuse.
        await ctx
            .http()
            .put(`${ws(s.workspace.id)}/attendance/sessions/${session.id}/records/${s.student.id}/abonement`)
            .set(...otherActor.auth)
            .send({ subscriptionId: subId })
            .expect(403)
        await ctx
            .http()
            .post(`${ws(s.workspace.id)}/attendance/check-in/preview`)
            .set(...otherStudentActor.auth)
            .send({ code: session.checkInCode })
            .expect(403)
        // Own club in the path, foreign session / code: not found there.
        await ctx
            .http()
            .put(`${ws(other.id)}/attendance/sessions/${session.id}/records/${s.student.id}/abonement`)
            .set(...otherActor.auth)
            .send({ subscriptionId: subId })
            .expect(404)
        const foreignCode = await ctx
            .http()
            .post(`${ws(other.id)}/attendance/check-in/preview`)
            .set(...otherStudentActor.auth)
            .send({ code: session.checkInCode })
        expect(foreignCode.status).toBeGreaterThanOrEqual(400)

        // Spending another club's abonement on an own class is refused.
        const otherGroup = await createGroup(other.id, otherOwner.id, 'Своя', null, [otherStudent.id])
        const otherSession = await sessionFor(other.id, otherGroup.id, otherOwner.id)
        await mark(other.id, otherSession.id, otherActor, [otherStudent.id], [
            { userId: otherStudent.id, subscriptionId: subId },
        ]).expect(400)
        expect(await left(subId)).toBe(7)
    })
})
