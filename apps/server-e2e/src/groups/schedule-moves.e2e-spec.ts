import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn, type Actor } from '../support/actors'
import {
    addMember,
    createGroupWithSlot,
    createPlan,
    createWorkspace,
} from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const DAY_MS = 24 * 3600_000

// Slot-local calendar date `n` days from now (UTC).
const ymd = (n: number) =>
    new Date(Date.now() + n * DAY_MS).toISOString().slice(0, 10)
const isoDow = (date: string) => {
    const js = new Date(`${date}T00:00:00Z`).getUTCDay()
    return js === 0 ? 7 : js
}

type Session = {
    slotId: string
    startAt: string
    cancelled: boolean
    cancellationReason: string | null
    recurring: boolean
    rescheduledFrom: { sessionDate: string; startAt: string } | null
    rescheduledTo: { slotId: string; sessionDate: string; startAt: string } | null
    booking: { booked: number } | null
}

// The admin calendar drags: «Только это занятие» (one class to another date and
// time, and back) and «Это и все следующие» (the weekly slot from a date on),
// against the real guards, Postgres and the schedule read model.
describe('schedule moves (admin calendar drag & drop)', () => {
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

    // Three days ahead: in the future in the gym's zone whatever time the suite
    // runs, and the class a week later is still inside the 14-day booking window.
    const D0 = ymd(3)
    const dayOfWeek = isoDow(D0)

    const club = async (opts: { booking?: boolean } = {}) => {
        const { workspace, owner } = await createWorkspace(ctx)
        const ownerActor = await signIn(ctx, owner.email as string)
        const { user: coach } = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.COACH,
        })
        const coachActor = await signIn(ctx, coach.email as string)
        const studio = await createGroupWithSlot(ctx, {
            workspaceId: workspace.id,
            coachUserId: coach.id,
            dayOfWeek,
            startTime: '19:00',
            durationMin: 60,
            name: 'Пилон',
        })
        if (opts.booking) {
            await ctx.prisma.group.update({
                where: { id: studio.group.id },
                data: { bookingMode: 'BOOKING', capacity: 5 },
            })
        }
        const plan = await createPlan(ctx, { workspaceId: workspace.id })
        return { workspace, owner, ownerActor, coach, coachActor, studio, plan }
    }
    type Club = Awaited<ReturnType<typeof club>>

    const bookedMember = async (c: Club, sessionDate: string) => {
        const { user } = await addMember(ctx, { workspaceId: c.workspace.id })
        await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/members/${user.id}/subscription`)
            .set(...c.ownerActor.auth)
            .send({ planId: c.plan.id })
            .expect(201)
        const actor = await signIn(ctx, user.email as string)
        await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/class-bookings`)
            .set(...actor.auth)
            .send({ slotId: c.studio.slot.id, sessionDate })
            .expect(201)
        return { user, actor }
    }

    const schedulePath = (c: Club) =>
        `/workspaces/${c.workspace.id}/groups/${c.studio.group.id}/schedule`

    const move = (
        c: Club,
        auth: [string, string],
        slotId: string,
        sessionDate: string,
        body: Record<string, unknown>,
    ) =>
        ctx
            .http()
            .post(`${schedulePath(c)}/slots/${slotId}/occurrences/${sessionDate}/move`)
            .set(...auth)
            .send(body)

    // The owner assigns another club coach to one class (approved at once).
    const assignSubstitute = async (c: Club, slotId: string, sessionDate: string) => {
        const { user: sub } = await addMember(ctx, {
            workspaceId: c.workspace.id,
            role: RolesEnum.COACH,
        })
        await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/class-substitutions`)
            .set(...c.ownerActor.auth)
            .send({ slotId, sessionDate, substituteId: sub.id })
            .expect(201)
        return sub
    }

    const split = (
        c: Club,
        auth: [string, string],
        slotId: string,
        body: Record<string, unknown>,
    ) =>
        ctx
            .http()
            .post(`${schedulePath(c)}/slots/${slotId}/split`)
            .set(...auth)
            .send(body)

    const sessions = async (
        c: Club,
        actor: Actor,
        from: string,
        to: string,
    ): Promise<Session[]> =>
        (
            await ctx
                .http()
                .get(`/workspaces/${c.workspace.id}/schedule`)
                .query({ from, to })
                .set(...actor.auth)
                .expect(200)
        ).body.sessions

    const notificationsOf = async (userId: string, kind: string) =>
        (await ctx.prisma.notification.findMany({ where: { userId } })).filter(
            (n) => (n.metadata as { kind?: string } | null)?.kind === kind,
        )

    it('moves one class with its booking, moves it again in place, then restores it', async () => {
        const c = await club({ booking: true })
        const m = await bookedMember(c, D0)
        const sub = await assignSubstitute(c, c.studio.slot.id, D0)
        const D1 = ymd(4)
        const D2 = ymd(5)

        const moved = await move(c, c.coachActor.auth, c.studio.slot.id, D0, {
            newDate: D1,
            startTime: '20:00',
            durationMin: 60,
        }).expect(201)
        expect(moved.body).toMatchObject({ sessionDate: D1, restored: false })
        const oneOffId: string = moved.body.slotId
        expect(oneOffId).not.toBe(c.studio.slot.id)

        let list = await sessions(c, m.actor, D0, D1)
        const ghost = list.find((s) => s.slotId === c.studio.slot.id)!
        expect(ghost).toMatchObject({
            cancelled: true,
            recurring: true,
            rescheduledTo: { slotId: oneOffId, sessionDate: D1 },
        })
        expect(ghost.cancellationReason).toMatch(/^Перенесено на \d\d\.\d\d в 20:00$/)
        const holder = list.find((s) => s.slotId === oneOffId)!
        expect(holder).toMatchObject({
            cancelled: false,
            recurring: false,
            rescheduledFrom: { sessionDate: D0, startAt: ghost.startAt },
            rescheduledTo: null,
            // The booking and the substitute coach travelled with the class.
            booking: { booked: 1 },
            substitution: { status: 'APPROVED', substitute: { id: sub.id } },
        })
        expect(ghost.substitution).toBeNull()
        expect(await ctx.prisma.classOccurrence.count()).toBe(1)

        // The booked member hears about it; the coach who moved it does not;
        // nothing announces a cancellation.
        const pushes = await notificationsOf(m.user.id, 'schedule.moved')
        expect(pushes).toHaveLength(1)
        expect(pushes[0].topic).toBe('Занятие перенесено')
        expect(pushes[0].message).toMatch(/^«Пилон»: .* → .* в 20:00$/)
        expect(await notificationsOf(c.coach.id, 'schedule.moved')).toHaveLength(0)
        expect(
            await ctx.prisma.auditEvent.count({ where: { action: 'group.occurrenceMove' } }),
        ).toBe(1)

        // Again: the one-off moves in place, the ghost follows.
        const again = await move(c, c.coachActor.auth, oneOffId, D1, {
            newDate: D2,
            startTime: '21:00',
            durationMin: 60,
            notify: false,
        }).expect(201)
        expect(again.body).toEqual({ slotId: oneOffId, sessionDate: D2, restored: false })
        list = await sessions(c, m.actor, D0, D2)
        expect(list.filter((s) => s.slotId === oneOffId)).toHaveLength(1)
        expect(list.find((s) => s.slotId === oneOffId)).toMatchObject({
            booking: { booked: 1 },
            rescheduledFrom: { sessionDate: D0 },
        })
        expect(
            list.find((s) => s.slotId === c.studio.slot.id)?.cancellationReason,
        ).toMatch(/в 21:00$/)
        expect(await notificationsOf(m.user.id, 'schedule.moved')).toHaveLength(1)

        // Back onto the origin date and time: restored.
        const back = await move(c, c.coachActor.auth, oneOffId, D2, {
            newDate: D0,
            startTime: '19:00',
            durationMin: 60,
        }).expect(201)
        expect(back.body).toEqual({
            slotId: c.studio.slot.id,
            sessionDate: D0,
            restored: true,
        })
        expect(
            await ctx.prisma.groupScheduleSlot.count({
                where: { groupId: c.studio.group.id },
            }),
        ).toBe(1)
        expect(await ctx.prisma.scheduleException.count()).toBe(0)
        list = await sessions(c, m.actor, D0, D2)
        expect(list).toHaveLength(1)
        expect(list[0]).toMatchObject({
            slotId: c.studio.slot.id,
            cancelled: false,
            recurring: true,
            rescheduledFrom: null,
            rescheduledTo: null,
            booking: { booked: 1 },
            substitution: { substitute: { id: sub.id } },
        })
        expect(
            await ctx.prisma.auditEvent.count({ where: { action: 'group.occurrenceMove' } }),
        ).toBe(3)
    })

    it('splits a slot with history, shifting a later booking, and merges back on undo', async () => {
        const c = await club({ booking: true })
        const nextWeek = ymd(10)
        const m = await bookedMember(c, nextWeek)
        // The class of the week after has only a substitute coach on it.
        const sub = await assignSubstitute(c, c.studio.slot.id, ymd(17))
        const D1 = ymd(4)

        const cut = await split(c, c.ownerActor.auth, c.studio.slot.id, {
            fromDate: D0,
            newDate: D1,
            startTime: '20:00',
            durationMin: 60,
        }).expect(201)
        expect(cut.body).toMatchObject({
            previousSlotId: c.studio.slot.id,
            merged: false,
            slot: {
                dayOfWeek: isoDow(D1),
                startTime: '20:00',
                effectiveFrom: D1,
                effectiveUntil: null,
            },
        })
        const newSlotId: string = cut.body.slot.id
        const old = await ctx.prisma.groupScheduleSlot.findUniqueOrThrow({
            where: { id: c.studio.slot.id },
        })
        expect(old.effectiveUntil?.toISOString().slice(0, 10)).toBe(ymd(2))

        // The booked class of next week moved one day on, with its booking.
        const occ = await ctx.prisma.classOccurrence.findFirstOrThrow()
        expect(occ.slotId).toBe(newSlotId)
        expect(occ.sessionDate.toISOString().slice(0, 10)).toBe(ymd(11))
        let list = await sessions(c, m.actor, ymd(10), ymd(11))
        expect(list).toHaveLength(1)
        expect(list[0]).toMatchObject({ slotId: newSlotId, booking: { booked: 1 } })
        // …and the substituted class shifted with the series.
        const subRow = await ctx.prisma.classSubstitution.findFirstOrThrow()
        expect(subRow).toMatchObject({
            slotId: newSlotId,
            occurrenceKey: `slot:${newSlotId}:${ymd(18)}`,
            substituteId: sub.id,
        })
        expect((await sessions(c, m.actor, ymd(18), ymd(18)))[0]).toMatchObject({
            slotId: newSlotId,
            substitution: { substitute: { id: sub.id } },
        })

        const pushes = await notificationsOf(m.user.id, 'schedule.moved')
        expect(pushes).toHaveLength(1)
        expect(pushes[0].topic).toBe('Расписание изменилось')
        // The coach was not the actor this time.
        expect(await notificationsOf(c.coach.id, 'schedule.moved')).toHaveLength(1)

        // Undo: the new slot has no history and continues the old series.
        const undo = await split(c, c.ownerActor.auth, newSlotId, {
            fromDate: D1,
            newDate: D0,
            startTime: '19:00',
            durationMin: 60,
            notify: false,
        }).expect(201)
        expect(undo.body).toEqual({
            slot: expect.objectContaining({
                id: c.studio.slot.id,
                effectiveUntil: null,
            }),
            previousSlotId: null,
            merged: true,
        })
        expect(
            await ctx.prisma.groupScheduleSlot.findUnique({ where: { id: newSlotId } }),
        ).toBeNull()
        list = await sessions(c, m.actor, ymd(10), ymd(11))
        expect(list).toHaveLength(1)
        expect(list[0]).toMatchObject({
            slotId: c.studio.slot.id,
            booking: { booked: 1 },
        })

        const audits = await ctx.prisma.auditEvent.findMany({
            where: { action: 'group.slotSplit' },
            orderBy: { createdAt: 'asc' },
        })
        expect(audits.map((a) => (a.metadata as { merged: boolean }).merged)).toEqual([
            false,
            true,
        ])
    })

    it('changes a slot without history in place', async () => {
        const c = await club()
        await ctx.prisma.groupScheduleSlot.update({
            where: { id: c.studio.slot.id },
            data: { effectiveFrom: new Date(`${D0}T00:00:00Z`) },
        })
        const D2 = ymd(5)
        const res = await split(c, c.coachActor.auth, c.studio.slot.id, {
            fromDate: D0,
            newDate: D2,
            startTime: '18:00',
            durationMin: 90,
        }).expect(201)
        expect(res.body).toEqual({
            slot: {
                id: c.studio.slot.id,
                dayOfWeek: isoDow(D2),
                startTime: '18:00',
                durationMin: 90,
                effectiveFrom: D2,
                effectiveUntil: null,
                capacity: null,
            },
            previousSlotId: null,
            merged: false,
        })
        expect(
            await ctx.prisma.groupScheduleSlot.count({
                where: { groupId: c.studio.group.id },
            }),
        ).toBe(1)
    })

    it('refuses a plain member and a coach of another group', async () => {
        const c = await club()
        const { user } = await addMember(ctx, { workspaceId: c.workspace.id })
        const member = await signIn(ctx, user.email as string)
        const { user: otherCoach } = await addMember(ctx, {
            workspaceId: c.workspace.id,
            role: RolesEnum.COACH,
        })
        await createGroupWithSlot(ctx, {
            workspaceId: c.workspace.id,
            coachUserId: otherCoach.id,
            dayOfWeek,
        })
        const stranger = await signIn(ctx, otherCoach.email as string)
        const body = { newDate: ymd(4), startTime: '20:00', durationMin: 60 }

        for (const actor of [member, stranger]) {
            await move(c, actor.auth, c.studio.slot.id, D0, body).expect(403)
            await split(c, actor.auth, c.studio.slot.id, {
                ...body,
                fromDate: D0,
            }).expect(403)
        }
        expect(await ctx.prisma.groupScheduleSlot.count()).toBe(2)
        expect(await ctx.prisma.scheduleException.count()).toBe(0)
    })

    it('refuses a past class and an overlap with another class of the group', async () => {
        const c = await club()
        const past = await move(c, c.coachActor.auth, c.studio.slot.id, ymd(-4), {
            newDate: ymd(4),
            startTime: '20:00',
            durationMin: 60,
        }).expect(400)
        expect(past.body.message).toContain('Прошедшее занятие нельзя перенести')

        const D1 = ymd(4)
        await ctx.prisma.groupScheduleSlot.create({
            data: {
                groupId: c.studio.group.id,
                dayOfWeek: isoDow(D1),
                startTime: '20:00',
                durationMin: 60,
            },
        })
        const busy = await move(c, c.coachActor.auth, c.studio.slot.id, D0, {
            newDate: D1,
            startTime: '20:30',
            durationMin: 60,
        }).expect(400)
        expect(busy.body.message).toContain('В это время у группы уже есть занятие')
        expect(await ctx.prisma.scheduleException.count()).toBe(0)
    })
})
