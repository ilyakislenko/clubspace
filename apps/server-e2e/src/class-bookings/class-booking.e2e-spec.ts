import { ClassBookingService } from '../../../server/src/domains/class-bookings/class-booking.service'
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
const HOUR_MS = 3600_000
// Join-code alphabet has no I/L/O/0/1.
const CODE = 'BKNG2345'

// «Запись на занятие»: a group in BOOKING mode has limited places per class, a
// waitlist promoted automatically, late cancels / no-shows that burn a class,
// staff overrides — against the real guards, Postgres row locks and the sweep.
describe('class booking («Запись на занятие»)', () => {
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

    // Two days ahead (UTC date): inside the 14-day window and in the future in
    // the gym's zone whatever time of day the suite runs.
    const classDate = new Date(Date.now() + 2 * DAY_MS)
    const sessionDate = classDate.toISOString().slice(0, 10)
    const dayOfWeek = classDate.getUTCDay() === 0 ? 7 : classDate.getUTCDay()

    const sweep = (now: Date) =>
        ctx.app.get(ClassBookingService, { strict: false }).sweep(now)

    const kindOf = (n: { metadata: unknown }) =>
        (n.metadata as { kind?: string } | null)?.kind
    const notificationsOf = async (userId: string, kind: string) =>
        (await ctx.prisma.notification.findMany({ where: { userId } })).filter(
            (n) => kindOf(n) === kind,
        )

    const club = async (opts: { capacity?: number | null } = {}) => {
        const { workspace, owner } = await createWorkspace(ctx)
        const ownerActor = await signIn(ctx, owner.email as string)
        const { user: coach } = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.COACH,
        })
        const studio = await createGroupWithSlot(ctx, {
            workspaceId: workspace.id,
            coachUserId: coach.id,
            dayOfWeek,
            startTime: '19:00',
            durationMin: 60,
            name: 'Пилон',
        })
        await ctx.prisma.group.update({
            where: { id: studio.group.id },
            data: {
                bookingMode: 'BOOKING',
                capacity: opts.capacity === undefined ? 2 : opts.capacity,
            },
        })
        const plan = await createPlan(ctx, {
            workspaceId: workspace.id,
            name: '8 занятий',
            classCount: 8,
        })
        return { workspace, owner, ownerActor, coach, studio, plan }
    }

    const giveAbonement = async (
        ownerActor: Actor,
        workspaceId: string,
        userId: string,
        planId: string,
    ) =>
        ctx
            .http()
            .post(`/workspaces/${workspaceId}/members/${userId}/subscription`)
            .set(...ownerActor.auth)
            .send({ planId })
            .expect(201)

    const member = async (
        c: Awaited<ReturnType<typeof club>>,
        opts: { abonement?: boolean } = {},
    ) => {
        const { user } = await addMember(ctx, { workspaceId: c.workspace.id })
        if (opts.abonement !== false) {
            await giveAbonement(c.ownerActor, c.workspace.id, user.id, c.plan.id)
        }
        const actor = await signIn(ctx, user.email as string)
        return { user, actor }
    }

    const book = (
        auth: [string, string],
        workspaceId: string,
        slotId: string,
        extra: [string, string] | null = null,
    ) => {
        const req = ctx
            .http()
            .post(`/workspaces/${workspaceId}/class-bookings`)
            .set(...auth)
        if (extra) req.set(...extra)
        return req.send({ slotId, sessionDate })
    }

    const cancel = (
        auth: [string, string],
        workspaceId: string,
        bookingId: string,
    ) =>
        ctx
            .http()
            .delete(`/workspaces/${workspaceId}/class-bookings/${bookingId}`)
            .set(...auth)

    const remaining = async (workspaceId: string, userId: string) =>
        (
            await ctx.prisma.subscription.findFirstOrThrow({
                where: { workspaceId, workspaceMember: { userId } },
            })
        ).classesRemaining

    it('never overbooks under parallel requests: exactly `capacity` places, the rest waitlisted, a double tap is one booking', async () => {
        const c = await club({ capacity: 3 })
        const members = await Promise.all(
            Array.from({ length: 6 }, () => member(c)),
        )

        const results = await Promise.all([
            ...members.map((m) =>
                book(m.actor.auth, c.workspace.id, c.studio.slot.id),
            ),
            // The first member taps twice.
            book(members[0].actor.auth, c.workspace.id, c.studio.slot.id),
        ])
        for (const r of results) expect(r.status).toBe(201)

        const rows = await ctx.prisma.classBooking.findMany()
        expect(rows).toHaveLength(6)
        expect(rows.filter((r) => r.status === 'BOOKED')).toHaveLength(3)
        expect(rows.filter((r) => r.status === 'WAITLISTED')).toHaveLength(3)
        // The double tap returned the same booking.
        const first = results.filter((_, i) => i === 0 || i === 6)
        expect(first[0].body.id).toBe(first[1].body.id)
        // Nothing is charged by booking.
        expect(await remaining(c.workspace.id, members[0].user.id)).toBe(8)

        // The schedule shows the places and the viewer's own status.
        const schedule = await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/schedule`)
            .query({ from: sessionDate, to: sessionDate })
            .set(...members[5].actor.auth)
            .expect(200)
        const session = schedule.body.sessions.find(
            (s: { slotId: string }) => s.slotId === c.studio.slot.id,
        )
        expect(session.booking).toMatchObject({ capacity: 3, booked: 3, waitlist: 3 })
        const mine = rows.find((r) => r.userId === members[5].user.id)!
        expect(session.booking.myBookingId).toBe(mine.id)
        expect(session.booking.myStatus).toBe(mine.status)
    })

    it('promotes the waitlist exactly once when a place frees, pushes the promoted member, who may decline', async () => {
        const c = await club({ capacity: 1 })
        const [a, b, d] = [await member(c), await member(c), await member(c)]
        const booked = await book(a.actor.auth, c.workspace.id, c.studio.slot.id).expect(201)
        expect(booked.body.status).toBe('BOOKED')
        const waitB = await book(b.actor.auth, c.workspace.id, c.studio.slot.id).expect(201)
        const waitD = await book(d.actor.auth, c.workspace.id, c.studio.slot.id).expect(201)
        expect(waitB.body).toMatchObject({ status: 'WAITLISTED', waitlistPosition: 1 })
        expect(waitD.body).toMatchObject({ status: 'WAITLISTED', waitlistPosition: 2 })

        // A cancels twice at once while the sweep runs: one place, one promotion.
        const [c1, c2] = await Promise.all([
            cancel(a.actor.auth, c.workspace.id, booked.body.id),
            cancel(a.actor.auth, c.workspace.id, booked.body.id),
            sweep(new Date()),
        ])
        expect(c1.status).toBe(200)
        expect(c2.status).toBe(200)
        expect(c1.body.status).toBe('CANCELLED')

        const rows = await ctx.prisma.classBooking.findMany()
        const byUser = new Map(rows.map((r) => [r.userId, r]))
        expect(byUser.get(b.user.id)).toMatchObject({ status: 'BOOKED' })
        expect(byUser.get(b.user.id)?.promotedAt).not.toBeNull()
        expect(byUser.get(d.user.id)?.status).toBe('WAITLISTED')
        expect(await notificationsOf(b.user.id, 'classbooking.promoted')).toHaveLength(1)
        expect(await notificationsOf(d.user.id, 'classbooking.promoted')).toHaveLength(0)
        // An in-time cancel burns nothing.
        expect(await remaining(c.workspace.id, a.user.id)).toBe(8)

        // B declines the place: D moves up.
        await cancel(b.actor.auth, c.workspace.id, waitB.body.id).expect(200)
        expect(
            (await ctx.prisma.classBooking.findUniqueOrThrow({ where: { id: waitD.body.id } }))
                .status,
        ).toBe('BOOKED')
        expect(await notificationsOf(d.user.id, 'classbooking.promoted')).toHaveLength(1)
    })

    it('a late cancel is recorded and burns a class when the club burns, and only records it when it does not', async () => {
        const c = await club()
        // The free-cancel deadline is 72 h before the class: already past.
        await ctx.prisma.group.update({
            where: { id: c.studio.group.id },
            data: { bookingCancelHours: 72 },
        })
        const m = await member(c)
        const first = await book(m.actor.auth, c.workspace.id, c.studio.slot.id).expect(201)
        expect(first.body.lateCancelNow).toBe(true)

        const late = await cancel(m.actor.auth, c.workspace.id, first.body.id).expect(200)
        expect(late.body).toMatchObject({
            status: 'LATE_CANCELLED',
            classBurned: true,
            burnedPlanName: '8 занятий',
        })
        expect(await remaining(c.workspace.id, m.user.id)).toBe(7)

        // The member sees it in their history with the reason.
        const mine = await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/class-bookings/mine`)
            .set(...m.actor.auth)
            .expect(200)
        expect(mine.body.upcoming).toHaveLength(0)
        expect(mine.body.history[0]).toMatchObject({
            id: first.body.id,
            status: 'LATE_CANCELLED',
            classBurned: true,
        })

        // The club switches burning off: the next late cancel only records it.
        await ctx
            .http()
            .patch(`/workspaces/${c.workspace.id}/settings`)
            .set(...c.ownerActor.auth)
            .send({ bookingLateCancelBurn: false })
            .expect(200)
        const again = await book(m.actor.auth, c.workspace.id, c.studio.slot.id).expect(201)
        expect(again.body.id).not.toBe(first.body.id)
        const recorded = await cancel(m.actor.auth, c.workspace.id, again.body.id).expect(200)
        expect(recorded.body).toMatchObject({ status: 'LATE_CANCELLED', classBurned: false })
        expect(await remaining(c.workspace.id, m.user.id)).toBe(7)
    })

    it('after the class: a no-show burns a class, an attendee is charged only the visit, a late mark refunds the burn', async () => {
        const c = await club({ capacity: 5 })
        const [present, absent, late] = [await member(c), await member(c), await member(c)]
        const booked = await Promise.all(
            [present, absent, late].map((m) =>
                book(m.actor.auth, c.workspace.id, c.studio.slot.id).expect(201),
            ),
        )
        const endAt = new Date(booked[0].body.endAt as string)

        // The coach takes attendance: the booked members are on the roster.
        const session = await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/attendance/sessions`)
            .set(...c.ownerActor.auth)
            .send({ kind: 'scheduled', slotId: c.studio.slot.id, sessionDate })
            .expect(201)
        const roster = await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/attendance/sessions/${session.body.id}/roster`)
            .set(...c.ownerActor.auth)
            .expect(200)
        expect(roster.body.roster).toHaveLength(0)
        expect(
            roster.body.expected.map((e: { userId: string; source: string }) => [e.userId, e.source]),
        ).toEqual(
            expect.arrayContaining([
                [present.user.id, 'booking'],
                [absent.user.id, 'booking'],
                [late.user.id, 'booking'],
            ]),
        )
        expect(roster.body.booking).toMatchObject({ capacity: 5, booked: 3, waitlist: [] })
        await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/attendance/sessions/${session.body.id}/records`)
            .set(...c.ownerActor.auth)
            .send({ userIds: [present.user.id] })
            .expect(201)

        // Not yet settled within the grace after the end.
        expect((await sweep(new Date(endAt.getTime() + HOUR_MS))).settled).toBe(0)
        const settled = await sweep(new Date(endAt.getTime() + 3 * HOUR_MS))
        expect(settled.settled).toBe(1)
        // A re-run is a no-op.
        expect((await sweep(new Date(endAt.getTime() + 4 * HOUR_MS))).settled).toBe(0)

        const status = async (userId: string) =>
            ctx.prisma.classBooking.findFirstOrThrow({ where: { userId } })
        expect(await status(present.user.id)).toMatchObject({ status: 'ATTENDED', classBurned: false })
        expect(await status(absent.user.id)).toMatchObject({ status: 'NO_SHOW', classBurned: true })
        expect(await remaining(c.workspace.id, present.user.id)).toBe(7)
        expect(await remaining(c.workspace.id, absent.user.id)).toBe(7)
        expect(await notificationsOf(absent.user.id, 'classbooking.noshow')).toHaveLength(1)

        // Staff see who did what and what it burned.
        const occ = await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/class-occurrences/${c.studio.slot.id}/${sessionDate}`)
            .set(...c.ownerActor.auth)
            .expect(200)
        expect(occ.body).toMatchObject({ settled: true, booked: 3, attended: 1 })
        const absentRow = occ.body.bookings.find((b: { userId: string }) => b.userId === absent.user.id)
        expect(absentRow).toMatchObject({ status: 'NO_SHOW', classBurned: true, burnedPlanName: '8 занятий' })

        // The coach marks the third member after all: the burn is refunded and
        // the visit charged instead — one class in total.
        await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/attendance/sessions/${session.body.id}/records`)
            .set(...c.ownerActor.auth)
            .send({ userIds: [late.user.id] })
            .expect(201)
        expect(await status(late.user.id)).toMatchObject({ status: 'ATTENDED', classBurned: false })
        expect(await remaining(c.workspace.id, late.user.id)).toBe(7)
    })

    it('staff add a member over the capacity; a member cannot', async () => {
        const c = await club({ capacity: 1 })
        const [a, b] = [await member(c), await member(c)]
        await book(a.actor.auth, c.workspace.id, c.studio.slot.id).expect(201)
        const waiting = await book(b.actor.auth, c.workspace.id, c.studio.slot.id).expect(201)
        expect(waiting.body.status).toBe('WAITLISTED')
        const { user: extra } = await addMember(ctx, { workspaceId: c.workspace.id })

        const coach = await signIn(ctx, c.coach.email as string)
        const path = `/workspaces/${c.workspace.id}/class-occurrences/${c.studio.slot.id}/${sessionDate}`
        // A member can't use the staff route.
        await ctx.http().post(`${path}/bookings`).set(...a.actor.auth).send({ userId: extra.id }).expect(403)

        const added = await ctx
            .http()
            .post(`${path}/bookings`)
            .set(...coach.auth)
            .send({ userId: extra.id })
            .expect(201)
        expect(added.body).toMatchObject({ capacity: 1, booked: 2, waitlist: 1 })
        const row = added.body.bookings.find((x: { userId: string }) => x.userId === extra.id)
        expect(row).toMatchObject({ status: 'BOOKED', overCapacity: true, bookedByOther: true })

        // The waitlisted member too, straight to a place.
        const moved = await ctx
            .http()
            .post(`${path}/bookings`)
            .set(...coach.auth)
            .send({ userId: b.user.id })
            .expect(201)
        expect(moved.body).toMatchObject({ booked: 3, waitlist: 0 })
        expect(await notificationsOf(extra.id, 'classbooking.added')).toHaveLength(1)
    })

    it('cancelling the class releases every booking, tells the members and burns nothing', async () => {
        const c = await club({ capacity: 1 })
        await ctx.prisma.group.update({
            where: { id: c.studio.group.id },
            data: { bookingCancelHours: 72 },
        })
        const [a, b] = [await member(c), await member(c)]
        await book(a.actor.auth, c.workspace.id, c.studio.slot.id).expect(201)
        await book(b.actor.auth, c.workspace.id, c.studio.slot.id).expect(201)

        const coach = await signIn(ctx, c.coach.email as string)
        await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/groups/${c.studio.group.id}/schedule/exceptions`)
            .set(...coach.auth)
            .send({
                slotId: c.studio.slot.id,
                fromDate: sessionDate,
                untilDate: sessionDate,
                reason: 'Ремонт зала',
            })
            .expect(201)

        const rows = await ctx.prisma.classBooking.findMany()
        expect(rows.map((r) => r.status)).toEqual(['CANCELLED_BY_CLUB', 'CANCELLED_BY_CLUB'])
        for (const m of [a, b]) {
            const notes = await notificationsOf(m.user.id, 'classbooking.club_cancelled')
            expect(notes).toHaveLength(1)
            expect(notes[0].message).toContain('Ремонт зала')
            expect(await remaining(c.workspace.id, m.user.id)).toBe(8)
        }
        // The class can't be booked any more, and the sweep burns nothing.
        await book(a.actor.auth, c.workspace.id, c.studio.slot.id).expect(400)
        await sweep(new Date(Date.now() + 5 * DAY_MS))
        expect(await remaining(c.workspace.id, a.user.id)).toBe(8)
        expect(
            await ctx.prisma.classBooking.count({ where: { status: 'CANCELLED_BY_CLUB' } }),
        ).toBe(2)
    })

    it('refuses a booking without an abonement that covers the class', async () => {
        const c = await club()
        const none = await member(c, { abonement: false })
        const res = await book(none.actor.auth, c.workspace.id, c.studio.slot.id)
        expect(res.status).toBe(400)
        expect(res.body.message).toContain('Нет абонемента')

        // An abonement of another direction doesn't cover a class of this one.
        const [pole, yoga] = await Promise.all(
            ['Пилон', 'Йога'].map((name) =>
                ctx.prisma.direction.create({ data: { workspaceId: c.workspace.id, name } }),
            ),
        )
        await ctx.prisma.group.update({
            where: { id: c.studio.group.id },
            data: { directionId: pole.id },
        })
        const yogaPlan = await createPlan(ctx, { workspaceId: c.workspace.id, name: 'Йога 8' })
        await ctx.prisma.planDirection.create({
            data: { planId: yogaPlan.id, directionId: yoga.id },
        })
        await giveAbonement(c.ownerActor, c.workspace.id, none.user.id, yogaPlan.id)
        const scoped = await book(none.actor.auth, c.workspace.id, c.studio.slot.id)
        expect(scoped.status).toBe(400)
        expect(scoped.body.message).toContain('Нет абонемента')
        expect(await ctx.prisma.classBooking.count()).toBe(0)
    })

    it('a parent books a class for their child (act-as)', async () => {
        const c = await club()
        await ctx.prisma.workspace.update({
            where: { id: c.workspace.id },
            data: { joinAutoApprove: true },
        })
        await ctx.prisma.workspaceJoinCode.create({
            data: { workspaceId: c.workspace.id, code: CODE },
        })
        const parent = await signIn(ctx, 'parent-booking@example.com')
        const child = (
            await ctx
                .http()
                .post('/me/dependents')
                .set(...parent.auth)
                .send({
                    firstname: 'Маша',
                    lastname: 'Иванова',
                    dateOfBirth: '2016-05-04',
                    consent: true,
                })
                .expect(201)
        ).body as { id: string }
        const actAs: [string, string] = ['X-Act-As', child.id]
        await ctx
            .http()
            .post('/workspaces/join')
            .set(...parent.auth)
            .set(...actAs)
            .send({ code: CODE })
            .expect(201)
        await giveAbonement(c.ownerActor, c.workspace.id, child.id, c.plan.id)

        const res = await book(parent.auth, c.workspace.id, c.studio.slot.id, actAs).expect(201)
        expect(res.body.status).toBe('BOOKED')
        const row = await ctx.prisma.classBooking.findUniqueOrThrow({ where: { id: res.body.id } })
        expect(row.userId).toBe(child.id)
        expect(row.bookedById).toBe(parent.userId)

        const mine = await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/class-bookings/mine`)
            .set(...parent.auth)
            .set(...actAs)
            .expect(200)
        expect(mine.body.upcoming.map((b: { id: string }) => b.id)).toEqual([res.body.id])
        // The parent is not a member: without act-as there is nothing to book.
        await book(parent.auth, c.workspace.id, c.studio.slot.id).expect(403)
    })

    it('keeps clubs apart and staff to their own groups', async () => {
        const a = await club()
        const m = await member(a)
        const booking = await book(m.actor.auth, a.workspace.id, a.studio.slot.id).expect(201)

        const { workspace: other, owner: otherOwner } = await createWorkspace(ctx)
        const otherAdmin = await signIn(ctx, otherOwner.email as string)
        const { user: stranger } = await addMember(ctx, { workspaceId: other.id })
        const strangerActor = await signIn(ctx, stranger.email as string)

        // Another club's member: refused at the door, and a foreign slot or
        // booking named through their own club is not found.
        await book(strangerActor.auth, a.workspace.id, a.studio.slot.id).expect(403)
        await book(strangerActor.auth, other.id, a.studio.slot.id).expect(404)
        await cancel(strangerActor.auth, other.id, booking.body.id).expect(404)
        await ctx
            .http()
            .get(`/workspaces/${a.workspace.id}/class-bookings/mine`)
            .set(...strangerActor.auth)
            .expect(403)

        // Another club's admin can't read or change this club's classes.
        const occPath = (ws: string) =>
            `/workspaces/${ws}/class-occurrences/${a.studio.slot.id}/${sessionDate}`
        await ctx.http().get(occPath(a.workspace.id)).set(...otherAdmin.auth).expect(403)
        await ctx.http().get(occPath(other.id)).set(...otherAdmin.auth).expect(404)
        await ctx
            .http()
            .post(`${occPath(other.id)}/bookings`)
            .set(...otherAdmin.auth)
            .send({ userId: m.user.id })
            .expect(404)
        await ctx
            .http()
            .put(`${occPath(other.id)}/capacity`)
            .set(...otherAdmin.auth)
            .send({ capacity: 50 })
            .expect(404)

        // Inside the club: a member can't cancel someone else's booking, and a
        // coach of another group can't run this class.
        const peer = await member(a)
        await cancel(peer.actor.auth, a.workspace.id, booking.body.id).expect(404)
        const { user: otherCoach } = await addMember(ctx, {
            workspaceId: a.workspace.id,
            role: RolesEnum.COACH,
        })
        const otherCoachActor = await signIn(ctx, otherCoach.email as string)
        await ctx.http().get(occPath(a.workspace.id)).set(...otherCoachActor.auth).expect(403)
        await ctx
            .http()
            .put(`${occPath(a.workspace.id)}/capacity`)
            .set(...otherCoachActor.auth)
            .send({ capacity: 50 })
            .expect(403)
        expect(
            (await ctx.prisma.classBooking.findUniqueOrThrow({ where: { id: booking.body.id } }))
                .status,
        ).toBe('BOOKED')
    })

    it('a fixed group works as before: no class booking, the roster is its members, drop-ins still work', async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const ownerActor = await signIn(ctx, owner.email as string)
        const fixed = await createGroupWithSlot(ctx, {
            workspaceId: workspace.id,
            coachUserId: owner.id,
            dayOfWeek,
        })
        const other = await createGroupWithSlot(ctx, {
            workspaceId: workspace.id,
            coachUserId: owner.id,
            dayOfWeek,
            startTime: '10:00',
        })
        const { user } = await addMember(ctx, { workspaceId: workspace.id })
        await ctx.prisma.groupMember.create({
            data: { groupId: fixed.group.id, userId: user.id },
        })
        const plan = await createPlan(ctx, { workspaceId: workspace.id })
        await giveAbonement(ownerActor, workspace.id, user.id, plan.id)
        const actor = await signIn(ctx, user.email as string)

        const refused = await book(actor.auth, workspace.id, fixed.slot.id)
        expect(refused.status).toBe(400)
        expect(refused.body.message).toContain('постоянным составом')

        const schedule = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/schedule`)
            .query({ from: sessionDate, to: sessionDate })
            .set(...actor.auth)
            .expect(200)
        expect(
            schedule.body.sessions.every((s: { booking: unknown }) => s.booking === null),
        ).toBe(true)

        await ctx
            .http()
            .post(`/workspaces/${workspace.id}/drop-ins`)
            .set(...actor.auth)
            .send({ slotId: other.slot.id, sessionDate })
            .expect(201)

        const session = await ctx
            .http()
            .post(`/workspaces/${workspace.id}/attendance/sessions`)
            .set(...ownerActor.auth)
            .send({ kind: 'scheduled', slotId: fixed.slot.id, sessionDate })
            .expect(201)
        const roster = await ctx
            .http()
            .get(`/workspaces/${workspace.id}/attendance/sessions/${session.body.id}/roster`)
            .set(...ownerActor.auth)
            .expect(200)
        expect(roster.body.booking).toBeNull()
        expect(roster.body.roster.map((r: { userId: string }) => r.userId)).toEqual([user.id])
        expect(await ctx.prisma.classOccurrence.count()).toBe(0)
    })
})
