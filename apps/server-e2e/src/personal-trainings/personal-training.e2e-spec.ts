import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { Actor, signIn } from '../support/actors'
import { addMember, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const DAY_MS = 24 * 3600_000

// Dates are wall-clock in the club's zone; a few days ahead at 10:00 is in the
// future whatever the zone.
const ymd = (daysAhead: number) =>
    new Date(Date.now() + daysAhead * DAY_MS).toISOString().slice(0, 10)
const at = (daysAhead: number, hhmm = '10:00') => `${ymd(daysAhead)}T${hhmm}`

// A member asks a coach for a 1:1 session; the two agree on a time. The
// session is paid off-app, so marking it must never draw the member's group
// class pack.
describe('personal training', () => {
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

    const base = (workspaceId: string) =>
        `/workspaces/${workspaceId}/personal-trainings`

    const setup = async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const ownerActor = await signIn(ctx, owner.email)
        const { user: coach } = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.COACH,
        })
        const { user: otherCoach } = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.COACH,
        })
        const { user: member } = await addMember(ctx, {
            workspaceId: workspace.id,
        })
        const plan = await createPlan(ctx, {
            workspaceId: workspace.id,
            name: 'Разовое занятие',
            price: 50000,
            classCount: 1,
        })
        await ctx
            .http()
            .post(`/workspaces/${workspace.id}/members/${member.id}/subscription`)
            .set(...ownerActor.auth)
            .send({ planId: plan.id })
            .expect(201)
        return {
            workspace,
            ownerActor,
            coach,
            otherCoach,
            member,
            coachActor: await signIn(ctx, coach.email),
            otherCoachActor: await signIn(ctx, otherCoach.email),
            memberActor: await signIn(ctx, member.email),
        }
    }

    type Setup = Awaited<ReturnType<typeof setup>>

    const offer = (s: Setup, actor: Actor, enabled = true) =>
        ctx
            .http()
            .put(`${base(s.workspace.id)}/offer`)
            .set(...actor.auth)
            .send({ enabled })

    const request = (s: Setup, options: Array<{ startAt: string; durationMin: number }>) =>
        ctx
            .http()
            .post(base(s.workspace.id))
            .set(...s.memberActor.auth)
            .send({ coachId: s.coach.id, options })

    const act = (
        s: Setup,
        actor: Actor,
        requestId: string,
        action: 'accept' | 'propose' | 'decline' | 'cancel',
        body: object = {},
    ) =>
        ctx
            .http()
            .post(`${base(s.workspace.id)}/${requestId}/${action}`)
            .set(...actor.auth)
            .send(body)

    const noticesFor = async (userId: string, kind: string) =>
        (await ctx.prisma.notification.findMany({ where: { userId } })).filter(
            (n) => (n.metadata as { kind?: string } | null)?.kind === kind,
        )

    // Coach has opted in and the member has asked for two options.
    const requested = async () => {
        const s = await setup()
        await offer(s, s.coachActor).expect(200)
        const res = await request(s, [
            { startAt: at(3), durationMin: 60 },
            { startAt: at(4), durationMin: 90 },
        ]).expect(201)
        return { s, req: res.body as { id: string; options: Array<{ id: string }> } }
    }

    it('lists an opted-in coach on the member\'s form (and not before)', async () => {
        const s = await setup()
        const before = await ctx
            .http()
            .get(`${base(s.workspace.id)}/form`)
            .set(...s.memberActor.auth)
            .expect(200)
        expect(before.body.coaches).toEqual([])

        const res = await offer(s, s.coachActor)
        expect(res.status).toBe(200)
        expect(res.body).toEqual({ offersPersonalTraining: true })

        const after = await ctx
            .http()
            .get(`${base(s.workspace.id)}/form`)
            .set(...s.memberActor.auth)
            .expect(200)
        expect(after.body.coaches.map((c: { userId: string }) => c.userId)).toEqual([
            s.coach.id,
        ])
    })

    it('a plain member cannot opt in as a coach', async () => {
        const s = await setup()
        const res = await offer(s, s.memberActor)
        expect(res.status).toBe(403)
    })

    it('confirms a requested time: coach is told, a personal session appears without a code', async () => {
        const { s, req } = await requested()
        expect(await noticesFor(s.coach.id, 'personal.requested')).toHaveLength(1)

        const accepted = await act(s, s.coachActor, req.id, 'accept', {
            optionId: req.options[1].id,
        })
        expect(accepted.status).toBe(201)
        expect(accepted.body.status).toBe('CONFIRMED')
        expect(accepted.body.confirmedDurationMin).toBe(90)

        const session = await ctx.prisma.attendanceSession.findUniqueOrThrow({
            where: { id: accepted.body.sessionId },
        })
        expect(session).toMatchObject({
            isPersonal: true,
            checkInCode: null,
            groupId: null,
            slotId: null,
            coachId: s.coach.id,
            occurrenceKey: `personal:${req.id}`,
        })
        expect(await noticesFor(s.member.id, 'personal.confirmed')).toHaveLength(1)
    })

    it('marking a personal session records it but never draws the group pack', async () => {
        const { s, req } = await requested()
        const accepted = await act(s, s.coachActor, req.id, 'accept', {
            optionId: req.options[0].id,
        }).expect(201)
        const sessionId = accepted.body.sessionId as string

        const roster = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/attendance/sessions/${sessionId}/roster`)
            .set(...s.coachActor.auth)
            .expect(200)
        expect(roster.body.kind).toBe('personal')
        expect(roster.body.checkInCode).toBeNull()
        expect(roster.body.expected).toHaveLength(1)
        expect(roster.body.expected[0]).toMatchObject({
            userId: s.member.id,
            present: false,
            source: 'personal',
        })

        const marked = await ctx
            .http()
            .post(`/workspaces/${s.workspace.id}/attendance/sessions/${sessionId}/records`)
            .set(...s.coachActor.auth)
            .send({ userIds: [s.member.id] })
            .expect(201)
        expect(marked.body.expected[0].present).toBe(true)

        const sub = await ctx.prisma.subscription.findFirstOrThrow({
            where: { workspaceId: s.workspace.id },
        })
        expect(sub.classesRemaining).toBe(1)
        const record = await ctx.prisma.attendanceRecord.findFirstOrThrow({
            where: { sessionId, userId: s.member.id },
        })
        expect(record.consumedSubscriptionId).toBeNull()

        const mine = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/attendance/me`)
            .query({ from: ymd(-1), to: ymd(10) })
            .set(...s.memberActor.auth)
            .expect(200)
        expect(mine.body.sessions.map((x: { id: string }) => x.id)).toContain(sessionId)

        const detail = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/attendance/sessions/${sessionId}`)
            .set(...s.coachActor.auth)
            .expect(200)
        expect(detail.body).toMatchObject({ id: sessionId, attendeeCount: 1 })
    })

    it('counter-proposal: member accepts the latest coach time; a superseded one is a 409', async () => {
        const { s, req } = await requested()
        const first = await act(s, s.coachActor, req.id, 'propose', {
            startAt: at(5),
            durationMin: 60,
            comment: 'Удобнее позже',
        })
        expect(first.status).toBe(201)
        expect(first.body.status).toBe('PENDING_MEMBER')
        expect(await noticesFor(s.member.id, 'personal.proposed')).toHaveLength(1)

        const second = await act(s, s.coachActor, req.id, 'propose', {
            startAt: at(6),
            durationMin: 60,
        }).expect(201)
        // Two proposals reach the member as two distinct notifications.
        expect(await noticesFor(s.member.id, 'personal.proposed')).toHaveLength(2)

        const coachOptions = (second.body.options as Array<{ id: string; proposedBy: string }>).filter(
            (o) => o.proposedBy === 'coach',
        )
        expect(coachOptions).toHaveLength(2)
        const [stale, latest] = coachOptions

        const stale409 = await act(s, s.memberActor, req.id, 'accept', {
            optionId: stale.id,
        })
        expect(stale409.status).toBe(409)

        const ok = await act(s, s.memberActor, req.id, 'accept', {
            optionId: latest.id,
        })
        expect(ok.status).toBe(201)
        expect(ok.body.status).toBe('CONFIRMED')
        expect(await noticesFor(s.coach.id, 'personal.confirmed')).toHaveLength(1)
    })

    it('cancelling a confirmed request removes its session and tells the other side', async () => {
        const { s, req } = await requested()
        const accepted = await act(s, s.coachActor, req.id, 'accept', {
            optionId: req.options[0].id,
        }).expect(201)

        const res = await act(s, s.memberActor, req.id, 'cancel', {
            comment: 'Заболел',
        })
        expect(res.status).toBe(201)
        expect(res.body).toMatchObject({ status: 'CANCELLED', sessionId: null, closedByRole: 'member' })
        expect(
            await ctx.prisma.attendanceSession.count({
                where: { id: accepted.body.sessionId },
            }),
        ).toBe(0)
        const notes = await noticesFor(s.coach.id, 'personal.cancelled')
        expect(notes).toHaveLength(1)
        expect(notes[0].message).toContain('Заболел')
    })

    it('the coach declines a request and the member hears why', async () => {
        const { s, req } = await requested()
        const res = await act(s, s.coachActor, req.id, 'decline', {
            comment: 'Нет окон',
        })
        expect(res.status).toBe(201)
        expect(res.body).toMatchObject({ status: 'DECLINED', closedByRole: 'coach', closeComment: 'Нет окон' })
        expect(await noticesFor(s.member.id, 'personal.declined')).toHaveLength(1)
    })

    it('lists the request for both participants', async () => {
        const { s, req } = await requested()
        for (const actor of [s.memberActor, s.coachActor]) {
            const res = await ctx
                .http()
                .get(base(s.workspace.id))
                .set(...actor.auth)
                .expect(200)
            expect(res.body.data.map((r: { id: string }) => r.id)).toEqual([req.id])
        }
        const coachView = await ctx
            .http()
            .get(base(s.workspace.id))
            .set(...s.coachActor.auth)
            .expect(200)
        expect(coachView.body).toMatchObject({ canOffer: true, offersPersonalTraining: true })
    })

    it('hides the request and its session from a coach who is not a participant', async () => {
        const { s, req } = await requested()
        const accepted = await act(s, s.coachActor, req.id, 'accept', {
            optionId: req.options[0].id,
        }).expect(201)
        const sessionId = accepted.body.sessionId as string

        await ctx
            .http()
            .get(`${base(s.workspace.id)}/${req.id}`)
            .set(...s.otherCoachActor.auth)
            .expect(404)

        const marks = await ctx
            .http()
            .post(`/workspaces/${s.workspace.id}/attendance/sessions/${sessionId}/records`)
            .set(...s.otherCoachActor.auth)
            .send({ userIds: [s.member.id] })
        expect(marks.status).toBe(403)

        // The club owner (admin scope) can still see it.
        await ctx
            .http()
            .get(`${base(s.workspace.id)}/${req.id}`)
            .set(...s.ownerActor.auth)
            .expect(200)
    })

    it('refuses a coach who has not opted in, and a personal session cannot be deleted directly', async () => {
        const s = await setup()
        const refused = await request(s, [{ startAt: at(3), durationMin: 60 }])
        expect(refused.status).toBe(404)

        await offer(s, s.coachActor).expect(200)
        const res = await request(s, [{ startAt: at(3), durationMin: 60 }]).expect(201)
        const accepted = await act(s, s.coachActor, res.body.id, 'accept', {
            optionId: res.body.options[0].id,
        }).expect(201)

        const del = await ctx
            .http()
            .delete(
                `/workspaces/${s.workspace.id}/attendance/sessions/${accepted.body.sessionId}`,
            )
            .set(...s.coachActor.auth)
        expect(del.status).toBe(400)
        expect(
            await ctx.prisma.attendanceSession.count({
                where: { id: accepted.body.sessionId },
            }),
        ).toBe(1)
    })
})
