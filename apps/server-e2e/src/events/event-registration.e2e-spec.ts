import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn } from '../support/actors'
import { addMember, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const HOUR_MS = 3600_000

// «Мастер-класс»: an event with a price and a limit of places — registration
// with a waitlist under real Postgres row locks, staff «paid» marks, and a
// visit to a paid event never drawing a class pack.
describe('event registration («Мастер-класс»)', () => {
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

    // UTC wall clock; the event's timezone is UTC.
    const wall = (d: Date) => d.toISOString().slice(0, 16)

    const club = async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const ownerActor = await signIn(ctx, owner.email as string)
        const plan = await createPlan(ctx, {
            workspaceId: workspace.id,
            name: '8 занятий',
            classCount: 8,
        })
        return { workspace, owner, ownerActor, plan }
    }
    type Club = Awaited<ReturnType<typeof club>>

    const member = async (c: Club, opts: { abonement?: boolean } = {}) => {
        const { user } = await addMember(ctx, { workspaceId: c.workspace.id })
        if (opts.abonement) {
            await ctx
                .http()
                .post(`/workspaces/${c.workspace.id}/members/${user.id}/subscription`)
                .set(...c.ownerActor.auth)
                .send({ planId: c.plan.id })
                .expect(201)
        }
        const actor = await signIn(ctx, user.email as string)
        return { user, actor }
    }

    const createEvent = async (
        c: Club,
        ticket: { price?: number | null; capacity?: number | null },
        startInMs = 2 * 24 * HOUR_MS,
    ) => {
        const start = new Date(Date.now() + startInMs)
        const res = await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/events`)
            .set(...c.ownerActor.auth)
            .send({
                title: 'Мастер-класс',
                startAt: wall(start),
                endAt: wall(new Date(start.getTime() + 2 * HOUR_MS)),
                timezone: 'UTC',
                hostName: 'Приглашённый педагог',
                ...ticket,
            })
            .expect(201)
        return res.body as { id: string }
    }

    const register = (auth: [string, string], workspaceId: string, eventId: string) =>
        ctx
            .http()
            .post(`/workspaces/${workspaceId}/events/${eventId}/registrations`)
            .set(...auth)

    const cancel = (auth: [string, string], workspaceId: string, id: string) =>
        ctx
            .http()
            .delete(`/workspaces/${workspaceId}/event-registrations/${id}`)
            .set(...auth)

    const remaining = async (workspaceId: string, userId: string) =>
        (
            await ctx.prisma.subscription.findFirstOrThrow({
                where: { workspaceId, workspaceMember: { userId } },
            })
        ).classesRemaining

    it('never oversells the last place under parallel requests; a double tap is one registration', async () => {
        const c = await club()
        const event = await createEvent(c, { price: 1500, capacity: 1 })
        const members = await Promise.all(Array.from({ length: 5 }, () => member(c)))

        const results = await Promise.all([
            ...members.map((m) => register(m.actor.auth, c.workspace.id, event.id)),
            register(members[0].actor.auth, c.workspace.id, event.id),
        ])
        for (const r of results) expect(r.status).toBe(201)
        expect(results[0].body.id).toBe(results[5].body.id)

        const rows = await ctx.prisma.eventRegistration.findMany()
        expect(rows).toHaveLength(5)
        expect(rows.filter((r) => r.status === 'BOOKED')).toHaveLength(1)
        expect(rows.filter((r) => r.status === 'WAITLISTED')).toHaveLength(4)

        const list = await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/events/${event.id}/registrations`)
            .set(...c.ownerActor.auth)
            .expect(200)
        expect(list.body).toMatchObject({ capacity: 1, price: 1500, booked: 1, waitlist: 4 })
    })

    it('promotes the waitlist once when the place frees and pushes the promoted member', async () => {
        const c = await club()
        const event = await createEvent(c, { price: 1500, capacity: 1 })
        const [a, b, d] = [await member(c), await member(c), await member(c)]
        const booked = await register(a.actor.auth, c.workspace.id, event.id).expect(201)
        expect(booked.body.status).toBe('BOOKED')
        const waitB = await register(b.actor.auth, c.workspace.id, event.id).expect(201)
        const waitD = await register(d.actor.auth, c.workspace.id, event.id).expect(201)
        expect(waitB.body).toMatchObject({ status: 'WAITLISTED', waitlistPosition: 1 })
        expect(waitD.body).toMatchObject({ status: 'WAITLISTED', waitlistPosition: 2 })

        // A cancels twice at once: one place, one promotion.
        const [c1, c2] = await Promise.all([
            cancel(a.actor.auth, c.workspace.id, booked.body.id),
            cancel(a.actor.auth, c.workspace.id, booked.body.id),
        ])
        expect(c1.status).toBe(200)
        expect(c2.status).toBe(200)

        const rows = await ctx.prisma.eventRegistration.findMany()
        const byUser = new Map(rows.map((r) => [r.userId, r]))
        expect(byUser.get(a.user.id)?.status).toBe('CANCELLED')
        expect(byUser.get(b.user.id)?.status).toBe('BOOKED')
        expect(byUser.get(b.user.id)?.promotedAt).not.toBeNull()
        expect(byUser.get(d.user.id)?.status).toBe('WAITLISTED')

        const pushes = (
            await ctx.prisma.notification.findMany({ where: { userId: b.user.id } })
        ).filter(
            (n) =>
                (n.metadata as { kind?: string } | null)?.kind ===
                'eventregistration.promoted',
        )
        expect(pushes).toHaveLength(1)

        // Raising the limit promotes the next one.
        await ctx
            .http()
            .patch(`/workspaces/${c.workspace.id}/events/${event.id}`)
            .set(...c.ownerActor.auth)
            .send({ capacity: 2 })
            .expect(200)
        expect(
            (await ctx.prisma.eventRegistration.findFirstOrThrow({ where: { userId: d.user.id } }))
                .status,
        ).toBe('BOOKED')
    })

    it('a free event without a limit has no registration', async () => {
        const c = await club()
        const event = await createEvent(c, {})
        const m = await member(c)
        const res = await register(m.actor.auth, c.workspace.id, event.id)
        expect(res.status).toBeGreaterThanOrEqual(400)
        expect(await ctx.prisma.eventRegistration.count()).toBe(0)
    })

    it('marks paid by staff only; members cannot see the list or mark themselves', async () => {
        const c = await club()
        const event = await createEvent(c, { price: 1500, capacity: 5 })
        const m = await member(c)
        const { user: coach } = await addMember(ctx, {
            workspaceId: c.workspace.id,
            role: RolesEnum.COACH,
        })
        const coachActor = await signIn(ctx, coach.email as string)
        const reg = await register(m.actor.auth, c.workspace.id, event.id).expect(201)

        await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/events/${event.id}/registrations`)
            .set(...m.actor.auth)
            .expect(403)
        await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/event-registrations/${reg.body.id}/payment`)
            .set(...m.actor.auth)
            .send({ method: 'CASH' })
            .expect(403)

        const paid = await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/event-registrations/${reg.body.id}/payment`)
            .set(...coachActor.auth)
            .send({ method: 'CASH' })
            .expect(201)
        expect(paid.body.isPaid).toBe(true)
        // Only admins take a «paid» mark back.
        await ctx
            .http()
            .delete(`/workspaces/${c.workspace.id}/event-registrations/${reg.body.id}/payment`)
            .set(...coachActor.auth)
            .expect(403)
        await ctx
            .http()
            .delete(`/workspaces/${c.workspace.id}/event-registrations/${reg.body.id}/payment`)
            .set(...c.ownerActor.auth)
            .expect(200)
    })

    it('a visit to a paid event does not draw the abonement; a free event does, as before', async () => {
        const c = await club()
        const m = await member(c, { abonement: true })
        expect(await remaining(c.workspace.id, m.user.id)).toBe(8)

        const markVisit = async (eventId: string) => {
            const session = await ctx
                .http()
                .post(`/workspaces/${c.workspace.id}/attendance/sessions`)
                .set(...c.ownerActor.auth)
                .send({ kind: 'event', workspaceEventId: eventId })
                .expect(201)
            await ctx
                .http()
                .post(
                    `/workspaces/${c.workspace.id}/attendance/sessions/${session.body.id}/records`,
                )
                .set(...c.ownerActor.auth)
                .send({ userIds: [m.user.id] })
                .expect(201)
        }

        const paid = await createEvent(c, { price: 1500, capacity: 10 }, 0)
        await markVisit(paid.id)
        expect(await remaining(c.workspace.id, m.user.id)).toBe(8)

        const free = await createEvent(c, {}, 0)
        await markVisit(free.id)
        expect(await remaining(c.workspace.id, m.user.id)).toBe(7)
    })
})
