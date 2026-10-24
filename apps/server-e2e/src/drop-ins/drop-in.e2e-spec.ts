import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn } from '../support/actors'
import {
    addMember,
    createGroupWithSlot,
    createPlan,
    createWorkspace,
} from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const DAY_MS = 24 * 3600_000

// A member of one group books a class in another («Приду на тренировку»). The
// booking itself charges nothing: a class is taken only when the coach marks
// the guest present, which is what makes «Разовое занятие» (a 1-class pack)
// work for visitors.
describe('drop-in visits', () => {
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

    // Two days ahead (UTC date), well inside the 30-day window and in the
    // future in the gym's zone whatever time of day the suite runs.
    const classDate = new Date(Date.now() + 2 * DAY_MS)
    const sessionDate = classDate.toISOString().slice(0, 10)
    const dayOfWeek = classDate.getUTCDay() === 0 ? 7 : classDate.getUTCDay()

    const setup = async (opts: { classCount?: number } = {}) => {
        const { workspace, owner } = await createWorkspace(ctx)
        const ownerActor = await signIn(ctx, owner.email)
        const { user: coach } = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.COACH,
        })
        const target = await createGroupWithSlot(ctx, {
            workspaceId: workspace.id,
            coachUserId: coach.id,
            dayOfWeek,
            startTime: '19:00',
            durationMin: 90,
        })
        const home = await createGroupWithSlot(ctx, {
            workspaceId: workspace.id,
            coachUserId: coach.id,
            dayOfWeek,
        })
        const { user: member } = await addMember(ctx, {
            workspaceId: workspace.id,
        })
        await ctx.prisma.groupMember.create({
            data: { groupId: home.group.id, userId: member.id },
        })
        const plan = await createPlan(ctx, {
            workspaceId: workspace.id,
            name: 'Разовое занятие',
            price: 50000,
            classCount: opts.classCount ?? 1,
        })
        await ctx
            .http()
            .post(`/workspaces/${workspace.id}/members/${member.id}/subscription`)
            .set(...ownerActor.auth)
            .send({ planId: plan.id })
            .expect(201)
        const memberActor = await signIn(ctx, member.email)
        return { workspace, ownerActor, coach, target, home, member, memberActor }
    }

    const book = (
        auth: [string, string],
        workspaceId: string,
        slotId: string,
        date = sessionDate,
    ) =>
        ctx
            .http()
            .post(`/workspaces/${workspaceId}/drop-ins`)
            .set(...auth)
            .send({ slotId, sessionDate: date })

    const kindOf = (n: { metadata: unknown }) =>
        (n.metadata as { kind?: string } | null)?.kind

    const coachNotifications = async (coachId: string, kind: string) =>
        (
            await ctx.prisma.notification.findMany({ where: { userId: coachId } })
        ).filter((n) => kindOf(n) === kind)

    it('books another group with a single-visit pack, charges nothing and tells the coach', async () => {
        const { workspace, coach, target, memberActor } = await setup()

        const res = await book(memberActor.auth, workspace.id, target.slot.id)
        expect(res.status).toBe(201)
        expect(res.body.groupId).toBe(target.group.id)
        expect(res.body.sessionDate).toBe(sessionDate)

        const sub = await ctx.prisma.subscription.findFirstOrThrow({
            where: { workspaceId: workspace.id },
        })
        expect(sub.classesRemaining).toBe(1)
        expect(await ctx.prisma.dropInBooking.count()).toBe(1)

        const notes = await coachNotifications(coach.id, 'dropin.booked')
        expect(notes).toHaveLength(1)
        expect(notes[0].message).toContain(target.group.name)

        const mine = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/drop-ins/mine`)
            .set(...memberActor.auth)
            .expect(200)
        // The single class is now spoken for by this booking.
        expect(mine.body.canBook).toBe(false)
        expect(mine.body.blockedReason).toContain(
            'Все занятия абонемента уже распределены по записям',
        )
        expect(mine.body.bookings.map((b: { id: string }) => b.id)).toEqual([
            res.body.id,
        ])
    })

    it('is idempotent: booking twice returns the same booking and notifies once', async () => {
        const { workspace, coach, target, memberActor } = await setup()

        const first = await book(memberActor.auth, workspace.id, target.slot.id)
        const second = await book(memberActor.auth, workspace.id, target.slot.id)

        expect(first.status).toBe(201)
        expect(second.status).toBe(201)
        expect(second.body.id).toBe(first.body.id)
        expect(await ctx.prisma.dropInBooking.count()).toBe(1)
        expect(await coachNotifications(coach.id, 'dropin.booked')).toHaveLength(1)
    })

    it('shows the guest as expected on the opened roster, and present once marked (taking the class)', async () => {
        const { workspace, ownerActor, target, member, memberActor } =
            await setup()
        await book(memberActor.auth, workspace.id, target.slot.id).expect(201)

        const created = await ctx
            .http()
            .post(`/workspaces/${workspace.id}/attendance/sessions`)
            .set(...ownerActor.auth)
            .send({ kind: 'scheduled', slotId: target.slot.id, sessionDate })
            .expect(201)
        const sessionId = created.body.id as string

        const roster = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/attendance/sessions/${sessionId}/roster`)
            .set(...ownerActor.auth)
            .expect(200)
        expect(roster.body.expected).toHaveLength(1)
        expect(roster.body.expected[0]).toMatchObject({
            userId: member.id,
            present: false,
            source: 'booking',
        })

        const marked = await ctx
            .http()
            .post(`/workspaces/${workspace.id}/attendance/sessions/${sessionId}/records`)
            .set(...ownerActor.auth)
            .send({ userIds: [member.id] })
            .expect(201)
        expect(marked.body.expected[0].present).toBe(true)

        const sub = await ctx.prisma.subscription.findFirstOrThrow({
            where: { workspaceId: workspace.id },
        })
        expect(sub.classesRemaining).toBe(0)
        const record = await ctx.prisma.attendanceRecord.findFirstOrThrow({
            where: { sessionId, userId: member.id },
        })
        expect(record.isGuest).toBe(true)
        expect(record.consumedSubscriptionId).toBe(sub.id)
    })

    it('refuses when the club turned guest visits off', async () => {
        const { workspace, ownerActor, target, memberActor } = await setup()
        await ctx
            .http()
            .patch(`/workspaces/${workspace.id}/settings`)
            .set(...ownerActor.auth)
            .send({ guestVisitsEnabled: false })
            .expect(200)

        const res = await book(memberActor.auth, workspace.id, target.slot.id)
        expect(res.status).toBe(403)
        expect(res.body.message).toBe(
            'Гостевые визиты в другие группы отключены в клубе',
        )
        expect(await ctx.prisma.dropInBooking.count()).toBe(0)
    })

    it('refuses a second booking once open bookings use up a 1-class pack', async () => {
        const { workspace, target, memberActor } = await setup()
        const nextWeek = new Date(classDate.getTime() + 7 * DAY_MS)
            .toISOString()
            .slice(0, 10)

        await book(memberActor.auth, workspace.id, target.slot.id).expect(201)
        const res = await book(
            memberActor.auth,
            workspace.id,
            target.slot.id,
            nextWeek,
        )
        expect(res.status).toBe(400)
        expect(res.body.message).toContain(
            'Все занятия абонемента уже распределены по записям',
        )
        expect(await ctx.prisma.dropInBooking.count()).toBe(1)

        // Re-sending the booking that already holds the class is still fine.
        await book(memberActor.auth, workspace.id, target.slot.id).expect(201)
    })

    it('still lists and cancels bookings after the club turns guest visits off', async () => {
        const { workspace, ownerActor, target, memberActor } = await setup()
        const booked = await book(memberActor.auth, workspace.id, target.slot.id)
        await ctx
            .http()
            .patch(`/workspaces/${workspace.id}/settings`)
            .set(...ownerActor.auth)
            .send({ guestVisitsEnabled: false })
            .expect(200)

        const mine = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/drop-ins/mine`)
            .set(...memberActor.auth)
            .expect(200)
        expect(mine.body.canBook).toBe(false)
        expect(mine.body.bookings).toHaveLength(1)

        await ctx
            .http()
            .delete(`/workspaces/${workspace.id}/drop-ins/${booked.body.id}`)
            .set(...memberActor.auth)
            .expect(200)
        expect(await ctx.prisma.dropInBooking.count()).toBe(0)
    })

    it('answers 400 to a cancel with a malformed booking id', async () => {
        const { workspace, memberActor } = await setup()
        await ctx
            .http()
            .delete(`/workspaces/${workspace.id}/drop-ins/not-a-uuid`)
            .set(...memberActor.auth)
            .expect(400)
    })

    it('refuses a class in the member\'s own group', async () => {
        const { workspace, home, memberActor } = await setup()
        const res = await book(memberActor.auth, workspace.id, home.slot.id)
        expect(res.status).toBe(400)
        expect(await ctx.prisma.dropInBooking.count()).toBe(0)
    })

    it('refuses an expired pack', async () => {
        const { workspace, target, memberActor } = await setup()
        await ctx.prisma.subscription.updateMany({
            where: { workspaceId: workspace.id },
            data: { endDate: new Date(Date.now() - DAY_MS) },
        })
        const res = await book(memberActor.auth, workspace.id, target.slot.id)
        expect(res.status).toBe(400)
        expect(await ctx.prisma.dropInBooking.count()).toBe(0)
    })

    it('cancels: the row goes, the coach is told, and cancelling again is a 200', async () => {
        const { workspace, coach, target, memberActor } = await setup()
        const booked = await book(memberActor.auth, workspace.id, target.slot.id)
        const url = `/workspaces/${workspace.id}/drop-ins/${booked.body.id}`

        const first = await ctx.http().delete(url).set(...memberActor.auth)
        expect(first.status).toBe(200)
        expect(first.body).toEqual({ status: 'cancelled' })
        expect(await ctx.prisma.dropInBooking.count()).toBe(0)
        expect(await coachNotifications(coach.id, 'dropin.cancelled')).toHaveLength(1)

        const again = await ctx.http().delete(url).set(...memberActor.auth)
        expect(again.status).toBe(200)
    })
})
