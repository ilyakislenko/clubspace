import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn, type Actor } from '../support/actors'
import { addMember, createGroupWithSlot, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const DAY_MS = 86_400_000

// The class a week ahead and the one after it, on the slot's weekday (ISO).
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const NEXT = new Date(Date.now() + 7 * DAY_MS)
const DATE = ymd(NEXT)
const LATER = ymd(new Date(NEXT.getTime() + 7 * DAY_MS))
const DOW = NEXT.getUTCDay() === 0 ? 7 : NEXT.getUTCDay()

// Замены тренеров: who may mark attendance of another coach's class. Club
// admins (owner, admin, head coach) mark any class of their club; a plain
// coach only their own groups — or a class they substitute in once whoever
// runs the group approved it, or every class while the club allows it.
describe('class substitutions', () => {
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
    const http = () => ctx.http()

    const memberActor = async (workspaceId: string, role?: RolesEnum) => {
        const { user } = await addMember(ctx, { workspaceId, role })
        return { user, actor: await signIn(ctx, user.email!) }
    }

    // Club A: `lead` coaches the group, `coach` is a plain coach of the club,
    // `student` trains in the group.
    const setup = async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const w = workspace.id
        const ownerActor = await signIn(ctx, owner.email!)
        const lead = await memberActor(w, RolesEnum.COACH)
        const coach = await memberActor(w, RolesEnum.COACH)
        const head = await memberActor(w, RolesEnum.HEAD_COACH)
        const admin = await memberActor(w, RolesEnum.ADMIN)
        const student = await memberActor(w)
        const { group, slot } = await createGroupWithSlot(ctx, {
            workspaceId: w,
            coachUserId: lead.user.id,
            dayOfWeek: DOW,
        })
        await ctx.prisma.groupMember.create({
            data: { groupId: group.id, userId: student.user.id },
        })
        return { w, owner, ownerActor, lead, coach, head, admin, student, group, slot }
    }
    type Club = Awaited<ReturnType<typeof setup>>

    const openSession = (c: Club, actor: Actor, sessionDate = DATE) =>
        http()
            .post(`${ws(c.w)}/attendance/sessions`)
            .set(...actor.auth)
            .send({ kind: 'scheduled', slotId: c.slot.id, sessionDate })

    const markRecords = (c: Club, actor: Actor, sessionId: string) =>
        http()
            .post(`${ws(c.w)}/attendance/sessions/${sessionId}/records`)
            .set(...actor.auth)
            .send({ userIds: [c.student.user.id] })

    // [open the class, mark a visit in it] as `actor`. The visit is marked in
    // the session the owner opened, so a refused open does not hide whether
    // marking alone is refused too.
    const tryMark = async (c: Club, actor: Actor, sessionDate = DATE) => {
        const open = await openSession(c, actor, sessionDate)
        const session = await openSession(c, c.ownerActor, sessionDate).expect(201)
        const mark = await markRecords(c, actor, session.body.id)
        return [open.status, mark.status]
    }

    const substitutions = (c: Club) => `${ws(c.w)}/class-substitutions`

    const offer = (c: Club, actor: Actor, body: Record<string, unknown> = {}) =>
        http()
            .post(substitutions(c))
            .set(...actor.auth)
            .send({ slotId: c.slot.id, sessionDate: DATE, ...body })

    it('club admins mark any class; a plain coach is refused another coach’s class', async () => {
        const c = await setup()
        expect(await tryMark(c, c.head.actor)).toEqual([201, 201])
        expect(await tryMark(c, c.admin.actor)).toEqual([201, 201])
        expect(await tryMark(c, c.ownerActor)).toEqual([201, 201])
        expect(await tryMark(c, c.lead.actor)).toEqual([201, 201])
        expect(await tryMark(c, c.coach.actor)).toEqual([403, 403])
    })

    it('an offer alone grants nothing; approval grants that class only; cancelling takes it back', async () => {
        const c = await setup()

        const pending = await offer(c, c.coach.actor).expect(201)
        expect(pending.body).toMatchObject({
            status: 'PENDING',
            kind: 'OFFER',
            substitute: { id: c.coach.user.id },
            canDecide: false,
            canCancel: true,
        })
        expect((await openSession(c, c.coach.actor)).status).toBe(403)

        // Another plain coach can neither approve nor override it.
        const other = await memberActor(c.w, RolesEnum.COACH)
        await http()
            .post(`${substitutions(c)}/${pending.body.id}/approve`)
            .set(...other.actor.auth)
            .expect(403)
        await offer(c, other.actor).expect(409)

        const approved = await http()
            .post(`${substitutions(c)}/${pending.body.id}/approve`)
            .set(...c.lead.actor.auth)
            .expect(201)
        expect(approved.body.substitution).toMatchObject({
            status: 'APPROVED',
            decidedById: c.lead.user.id,
        })

        // The substitute opens the class: the session is theirs.
        const session = await openSession(c, c.coach.actor).expect(201)
        const row = await ctx.prisma.attendanceSession.findUniqueOrThrow({
            where: { id: session.body.id },
        })
        expect(row.coachId).toBe(c.coach.user.id)
        await markRecords(c, c.coach.actor, session.body.id).expect(201)

        // Only that class: the week after is still someone else's.
        expect(await tryMark(c, c.coach.actor, LATER)).toEqual([403, 403])

        // Members see who runs it.
        const schedule = await http()
            .get(`${ws(c.w)}/schedule`)
            .query({ from: DATE, to: DATE })
            .set(...c.student.actor.auth)
            .expect(200)
        const cls = schedule.body.sessions.find(
            (s: { slotId: string }) => s.slotId === c.slot.id,
        )
        expect(cls.substitution).toMatchObject({
            id: pending.body.id,
            status: 'APPROVED',
            substitute: { id: c.coach.user.id },
        })

        // Withdrawn: the class (and its session) go back to the group coach.
        await http()
            .delete(`${substitutions(c)}/${pending.body.id}`)
            .set(...c.coach.actor.auth)
            .expect(200)
        expect(
            (
                await ctx.prisma.attendanceSession.findUniqueOrThrow({
                    where: { id: session.body.id },
                })
            ).coachId,
        ).toBe(c.lead.user.id)
        expect((await openSession(c, c.coach.actor)).status).toBe(403)
        expect((await markRecords(c, c.coach.actor, session.body.id)).status).toBe(403)
    })

    it('the group coach assigns a substitute at once; a plain coach may not assign anyone', async () => {
        const c = await setup()
        const other = await memberActor(c.w, RolesEnum.COACH)

        await offer(c, c.coach.actor, { substituteId: other.user.id }).expect(403)

        const assigned = await offer(c, c.lead.actor, { substituteId: c.coach.user.id }).expect(201)
        expect(assigned.body).toMatchObject({ status: 'APPROVED', kind: 'ASSIGN', canDecide: true })
        expect(await tryMark(c, c.coach.actor)).toEqual([201, 201])
        expect(await tryMark(c, other.actor)).toEqual([403, 403])
    })

    it('with «coaches mark any class» a plain coach marks without a substitution', async () => {
        const c = await setup()
        // Only club admins switch it.
        await http()
            .patch(`${ws(c.w)}/settings`)
            .set(...c.coach.actor.auth)
            .send({ coachesMarkAnyClass: true })
            .expect(403)
        await http()
            .patch(`${ws(c.w)}/settings`)
            .set(...c.ownerActor.auth)
            .send({ coachesMarkAnyClass: true })
            .expect(200)
        const me = await http()
            .get(`${ws(c.w)}/members/me`)
            .set(...c.coach.actor.auth)
            .expect(200)
        expect(me.body.marksAnyClass).toBe(true)
        expect(await tryMark(c, c.coach.actor, LATER)).toEqual([201, 201])
    })

    it('a head coach of another club reaches nothing of this one', async () => {
        const c = await setup()
        const { workspace: clubB } = await createWorkspace(ctx)
        const headB = await memberActor(clubB.id, RolesEnum.HEAD_COACH)
        const pending = await offer(c, c.coach.actor).expect(201)
        const session = await openSession(c, c.ownerActor).expect(201)

        // Through club A's routes: not a member there.
        expect((await openSession(c, headB.actor)).status).toBe(403)
        expect((await offer(c, headB.actor, { substituteId: headB.user.id })).status).toBe(403)
        expect(
            (
                await http()
                    .post(`${substitutions(c)}/${pending.body.id}/approve`)
                    .set(...headB.actor.auth)
            ).status,
        ).toBe(403)

        // Through club B's routes with club A's ids: not found there.
        const b = `${ws(clubB.id)}`
        const statusOf = async (req: Promise<{ status: number }>) => (await req).status
        expect(
            await statusOf(
                http()
                    .post(`${b}/attendance/sessions`)
                    .set(...headB.actor.auth)
                    .send({ kind: 'scheduled', slotId: c.slot.id, sessionDate: DATE }),
            ),
        ).toBe(404)
        expect(
            await statusOf(
                http()
                    .post(`${b}/attendance/sessions/${session.body.id}/records`)
                    .set(...headB.actor.auth)
                    .send({ userIds: [c.student.user.id] }),
            ),
        ).toBe(404)
        expect(
            await statusOf(
                http()
                    .post(`${b}/class-substitutions`)
                    .set(...headB.actor.auth)
                    .send({ slotId: c.slot.id, sessionDate: DATE, substituteId: headB.user.id }),
            ),
        ).toBe(404)
        expect(
            await statusOf(
                http()
                    .post(`${b}/class-substitutions/${pending.body.id}/approve`)
                    .set(...headB.actor.auth),
            ),
        ).toBe(404)

        const untouched = await ctx.prisma.classSubstitution.findUniqueOrThrow({
            where: { id: pending.body.id },
        })
        expect(untouched.status).toBe('PENDING')
    })
})
