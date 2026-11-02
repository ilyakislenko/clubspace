import { setTimeout as sleep } from 'node:timers/promises'

import { type Actor, signIn } from '../support/actors'
import { FakeGateway } from '../support/fake-payment-gateway'
import { addMember, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const HOUR_MS = 3600_000
const CODE = 'TCKT2345'

// A master class ticket paid online through the club's provider: the same
// Payment + webhook as an abonement, but the webhook marks the registration
// «paid ONLINE» instead of granting an abonement. The amount comes from the
// event, the webhook is idempotent, revenue counts the ticket once (through
// the registration), a refund takes the mark back, and a place given up
// before the money lands is left for staff to refund.
describe('event ticket paid online', () => {
    let ctx: TestApp
    const gateway = new FakeGateway()

    beforeAll(async () => {
        ctx = await createTestApp({ paymentGateway: gateway })
    })
    afterAll(async () => {
        await ctx?.close()
    })
    beforeEach(async () => {
        await resetDatabase(ctx.prisma)
        await ctx.seed.onApplicationBootstrap()
        ctx.mail.clear()
        gateway.reset()
    })

    const wall = (d: Date) => d.toISOString().slice(0, 16)

    const club = async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const ownerActor = await signIn(ctx, owner.email as string)
        return { workspace, ownerActor }
    }
    type Club = Awaited<ReturnType<typeof club>>

    const connect = (c: Club) =>
        ctx
            .http()
            .put(`/workspaces/${c.workspace.id}/payment-settings`)
            .set(...c.ownerActor.auth)
            .send({ provider: 'YOOKASSA', shopId: '123456', secretKey: 'live_secret_0001' })
            .expect(200)

    const member = async (c: Club) => {
        const { user } = await addMember(ctx, { workspaceId: c.workspace.id })
        return { user, actor: await signIn(ctx, user.email as string) }
    }

    const createEvent = async (c: Club, capacity: number | null) => {
        const start = new Date(Date.now() + 2 * 24 * HOUR_MS)
        const res = await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/events`)
            .set(...c.ownerActor.auth)
            .send({
                title: 'Мастер-класс: dancehall',
                startAt: wall(start),
                endAt: wall(new Date(start.getTime() + 2 * HOUR_MS)),
                timezone: 'UTC',
                price: 1500,
                capacity,
            })
            .expect(201)
        return res.body as { id: string }
    }

    const register = (c: Club, a: Actor, eventId: string, actAs?: [string, string]) => {
        const req = ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/events/${eventId}/registrations`)
            .set(...a.auth)
        return (actAs ? req.set(...actAs) : req).expect(201)
    }

    const checkout = (
        c: Club,
        a: Actor,
        registrationId: string,
        actAs?: [string, string],
    ) => {
        const req = ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/event-registrations/${registrationId}/checkout`)
            .set(...a.auth)
        // The client cannot set the price: whatever it sends is ignored.
        return (actAs ? req.set(...actAs) : req).send({ amount: 1, currency: 'USD' })
    }

    const succeed = async (c: Club, providerPaymentId: string) => {
        gateway.setStatus(providerPaymentId, 'SUCCEEDED')
        const notification = {
            type: 'notification',
            event: 'payment.succeeded',
            object: { id: providerPaymentId },
        }
        const send = () =>
            ctx
                .http()
                .post(`/payments/webhooks/yookassa/${c.workspace.id}`)
                .send(notification)
        expect((await send()).status).toBe(200)
        // Retried and concurrent deliveries change nothing.
        const dupes = await Promise.all([send(), send(), send()])
        expect(dupes.map((r) => r.status)).toEqual([200, 200, 200])
    }

    const revenue30d = (c: Club) =>
        ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/stats`)
            .set(...c.ownerActor.auth)
            .expect(200)
            .then((r) => r.body.revenue.revenue30d as number)

    const csvTicketRows = (c: Club) =>
        ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/exports/revenue.csv`)
            .set(...c.ownerActor.auth)
            .expect(200)
            .then((r) => r.text.split(/\r?\n/).filter((l) => l.includes('dancehall')))

    const registrationRow = (id: string) =>
        ctx.prisma.eventRegistration.findUniqueOrThrow({ where: { id } })

    it('webhook marks the ticket paid ONLINE once at the event’s price; revenue once; refund unmarks', async () => {
        const c = await club()
        await connect(c)
        const m = await member(c)
        const event = await createEvent(c, 3)
        const reg = (await register(c, m.actor, event.id)).body as { id: string }

        const listed = await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/events`)
            .set(...m.actor.auth)
            .expect(200)
        expect(
            listed.body.data.find((e: { id: string }) => e.id === event.id).registration,
        ).toMatchObject({ onlinePayment: true, mine: { id: reg.id, isPaid: false } })

        const before = await revenue30d(c)
        const created = await checkout(c, m.actor, reg.id)
        expect(created.status).toBe(201)
        const paymentId = created.body.payment.id as string
        expect(created.body).toMatchObject({
            confirmationUrl: 'https://provider.test/confirm/yk_1',
            payment: {
                eventRegistrationId: reg.id,
                planId: null,
                planName: 'Мастер-класс: dancehall',
                amount: 1500,
                currency: 'RUB',
                status: 'PENDING',
            },
        })
        expect(gateway.created).toHaveLength(1)
        expect(gateway.created[0].input).toMatchObject({
            paymentId,
            amount: 1500,
            currency: 'RUB',
            customerEmail: m.user.email,
            itemName: 'Билет «Мастер-класс: dancehall»',
            returnUrl: expect.stringMatching(new RegExp(`/payment/${paymentId}$`)),
        })
        // A double tap reuses the pending payment.
        const again = await checkout(c, m.actor, reg.id)
        expect(again.body.payment.id).toBe(paymentId)
        expect(gateway.created).toHaveLength(1)

        await succeed(c, 'yk_1')

        expect(await registrationRow(reg.id)).toMatchObject({
            status: 'BOOKED',
            isPaid: true,
            paymentMethod: 'ONLINE',
            amountPaid: 1500,
            currency: 'RUB',
            markedPaidById: null,
        })
        // A ticket, not an abonement.
        expect(await ctx.prisma.subscription.count({ where: { workspaceId: c.workspace.id } })).toBe(0)
        const mine = await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/me/payments/${paymentId}`)
            .set(...m.actor.auth)
            .expect(200)
        expect(mine.body).toMatchObject({
            status: 'SUCCEEDED',
            eventRegistrationId: reg.id,
            activationError: null,
        })
        expect(
            await ctx.prisma.auditEvent.count({
                where: { workspaceId: c.workspace.id, action: 'payment.succeeded' },
            }),
        ).toBe(1)

        expect(await revenue30d(c)).toBe(before + 1500)
        const rows = await csvTicketRows(c)
        expect(rows).toHaveLength(1)
        expect(rows[0]).toContain(`;${m.user.email};Мастер-класс: dancehall;1500;RUB;;;Событие;Онлайн`)

        // Staff marking it again does not sell it twice; the mark stays ONLINE.
        await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/event-registrations/${reg.id}/payment`)
            .set(...c.ownerActor.auth)
            .send({ method: 'CASH' })
            .expect(201)
        expect((await registrationRow(reg.id)).paymentMethod).toBe('ONLINE')
        expect(await revenue30d(c)).toBe(before + 1500)
        // Taking the mark alone back is refused: the money is returned by a refund.
        await ctx
            .http()
            .delete(`/workspaces/${c.workspace.id}/event-registrations/${reg.id}/payment`)
            .set(...c.ownerActor.auth)
            .expect(400)
        // Paid online: the member cannot pay again or cancel in the app.
        expect((await checkout(c, m.actor, reg.id)).status).toBe(400)
        await ctx
            .http()
            .delete(`/workspaces/${c.workspace.id}/event-registrations/${reg.id}`)
            .set(...m.actor.auth)
            .expect(400)

        const refunded = await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/payments/${paymentId}/refund`)
            .set(...c.ownerActor.auth)
            .expect(201)
        expect(refunded.body).toMatchObject({ status: 'REFUNDED', eventRegistrationId: reg.id })
        expect(gateway.refunds).toEqual([
            { providerPaymentId: 'yk_1', idempotenceKey: `refund-${paymentId}` },
        ])
        expect(await registrationRow(reg.id)).toMatchObject({
            status: 'BOOKED',
            isPaid: false,
            paymentMethod: null,
            amountPaid: null,
        })
        expect(await revenue30d(c)).toBe(before)
        expect(await csvTicketRows(c)).toEqual([])
        // Unpaid now: the member may give the place up.
        await ctx
            .http()
            .delete(`/workspaces/${c.workspace.id}/event-registrations/${reg.id}`)
            .set(...m.actor.auth)
            .expect(200)
    })

    it('no provider → 400; the waitlist cannot pay; a place given up before the money lands is left for staff', async () => {
        const c = await club()
        const first = await member(c)
        const second = await member(c)
        const event = await createEvent(c, 1)
        const booked = (await register(c, first.actor, event.id)).body as { id: string }
        const waiting = (await register(c, second.actor, event.id)).body as {
            id: string
            status: string
        }
        expect(waiting.status).toBe('WAITLISTED')

        // The club has no provider connected.
        const listed = await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/events`)
            .set(...first.actor.auth)
            .expect(200)
        expect(
            listed.body.data.find((e: { id: string }) => e.id === event.id).registration
                .onlinePayment,
        ).toBe(false)
        const noProvider = await checkout(c, first.actor, booked.id)
        expect(noProvider.status).toBe(400)
        expect(noProvider.body.message).toMatch(/не принимает онлайн-оплату/)

        await connect(c)
        const fromWaitlist = await checkout(c, second.actor, waiting.id)
        expect(fromWaitlist.status).toBe(400)
        expect(fromWaitlist.body.message).toMatch(/листе ожидания/)
        // Someone else's registration is not payable.
        expect((await checkout(c, second.actor, booked.id)).status).toBe(404)
        expect(gateway.created).toHaveLength(0)

        const before = await revenue30d(c)
        const started = await checkout(c, first.actor, booked.id)
        expect(started.status).toBe(201)
        const paymentId = started.body.payment.id as string
        // While on the provider's page the member gives the place up; it goes
        // to the waitlist.
        await ctx
            .http()
            .delete(`/workspaces/${c.workspace.id}/event-registrations/${booked.id}`)
            .set(...first.actor.auth)
            .expect(200)
        expect((await registrationRow(waiting.id)).status).toBe('BOOKED')

        await succeed(c, 'yk_1')

        // The money is in, the place is not: nothing is marked, staff see it.
        expect(await registrationRow(booked.id)).toMatchObject({
            status: 'CANCELLED',
            isPaid: false,
        })
        expect((await registrationRow(waiting.id)).isPaid).toBe(false)
        expect(await revenue30d(c)).toBe(before)
        const list = await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/payments`)
            .set(...c.ownerActor.auth)
            .expect(200)
        expect(list.body.data).toEqual([
            expect.objectContaining({
                id: paymentId,
                status: 'SUCCEEDED',
                eventRegistrationId: booked.id,
                activationError: 'Запись отменена до оплаты',
            }),
        ])
        const mine = await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/me/payments/${paymentId}`)
            .set(...first.actor.auth)
            .expect(200)
        expect(mine.body.activationError).toBe('Запись отменена до оплаты')

        await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/payments/${paymentId}/refund`)
            .set(...c.ownerActor.auth)
            .expect(201)
        expect(await revenue30d(c)).toBe(before)
        expect((await registrationRow(waiting.id)).isPaid).toBe(false)
    })

    it('a guardian pays the child’s ticket (act-as); the receipt goes to the guardian', async () => {
        const c = await club()
        await connect(c)
        await ctx.prisma.workspace.update({
            where: { id: c.workspace.id },
            data: { joinAutoApprove: true },
        })
        await ctx.prisma.workspaceJoinCode.create({
            data: { workspaceId: c.workspace.id, code: CODE },
        })
        const parent = await signIn(ctx, 'parent-ticket@example.com')
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
        const event = await createEvent(c, null)
        const reg = (await register(c, parent, event.id, actAs)).body as { id: string }

        const created = await checkout(c, parent, reg.id, actAs)
        expect(created.status).toBe(201)
        expect(gateway.created[0].input.customerEmail).toBe('parent-ticket@example.com')
        const payment = await ctx.prisma.payment.findUniqueOrThrow({
            where: { id: created.body.payment.id },
        })
        expect(payment.userId).toBe(child.id)

        await succeed(c, 'yk_1')
        expect(await registrationRow(reg.id)).toMatchObject({
            isPaid: true,
            paymentMethod: 'ONLINE',
        })
        const followed = await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/me/payments/${payment.id}`)
            .set(...parent.auth)
            .set(...actAs)
            .expect(200)
        expect(followed.body.status).toBe('SUCCEEDED')
    })

    // Real Postgres row locks: waits until a statement touching `table` is
    // blocked on a lock the test holds.
    const waitForLockWaiter = async (table: string) => {
        for (let i = 0; i < 100; i++) {
            const [row] = await ctx.prisma.$queryRaw<Array<{ n: number }>>`
                SELECT count(*)::int AS n FROM pg_stat_activity
                WHERE datname = current_database() AND wait_event_type = 'Lock'
                  AND query LIKE ${`%${table}%`}`
            if (row.n > 0) return
            await sleep(50)
        }
        throw new Error(`nothing waited on a lock of ${table}`)
    }

    it('an event whose ticket is being paid online is not deleted', async () => {
        const c = await club()
        await connect(c)
        const m = await member(c)
        const event = await createEvent(c, 3)
        const reg = (await register(c, m.actor, event.id)).body as { id: string }
        expect((await checkout(c, m.actor, reg.id)).status).toBe(201)
        // Deleting the registration would orphan the pending payment: when the
        // money lands it would match no ticket at all.
        const deleted = await ctx
            .http()
            .delete(`/workspaces/${c.workspace.id}/events/${event.id}`)
            .set(...c.ownerActor.auth)
        expect(deleted.status).toBe(400)
        expect(deleted.body.message).toMatch(/онлайн-оплата/)
        expect(await ctx.prisma.eventRegistration.count({ where: { eventId: event.id } })).toBe(1)
    })

    it('a cash mark landing between the webhook’s read and its write is kept; the online money is left to refund', async () => {
        const c = await club()
        await connect(c)
        const m = await member(c)
        const event = await createEvent(c, 3)
        const reg = (await register(c, m.actor, event.id)).body as { id: string }
        const created = await checkout(c, m.actor, reg.id)
        expect(created.status).toBe(201)
        const paymentId = created.body.payment.id as string
        const before = await revenue30d(c)
        gateway.setStatus('yk_1', 'SUCCEEDED')
        let webhook: Promise<{ status: number }> | undefined
        // A cash mark is written (uncommitted) before the webhook arrives: the
        // webhook still reads the ticket unpaid and then waits on the row.
        await ctx.prisma.$transaction(
            async (tx) => {
                await tx.$executeRaw`
                    UPDATE "EventRegistration"
                    SET "isPaid" = true, "paidAt" = now(), "amountPaid" = 1500,
                        "currency" = 'RUB', "paymentMethod" = 'CASH'
                    WHERE "id" = ${reg.id}::uuid`
                webhook = ctx
                    .http()
                    .post(`/payments/webhooks/yookassa/${c.workspace.id}`)
                    .send({
                        type: 'notification',
                        event: 'payment.succeeded',
                        object: { id: 'yk_1' },
                    })
                    .then((r) => r)
                await waitForLockWaiter('EventRegistration')
            },
            { timeout: 20_000 },
        )
        expect((await webhook)?.status).toBe(200)

        // The cash mark stands; the online payment is flagged for a refund.
        expect(await registrationRow(reg.id)).toMatchObject({
            isPaid: true,
            paymentMethod: 'CASH',
            amountPaid: 1500,
        })
        const list = await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/payments`)
            .set(...c.ownerActor.auth)
            .expect(200)
        expect(list.body.data).toEqual([
            expect.objectContaining({
                id: paymentId,
                status: 'SUCCEEDED',
                activationError: 'Билет уже отмечен оплаченным',
            }),
        ])
        expect(await revenue30d(c)).toBe(before + 1500)

        // Refunding it gives the online money back and leaves the cash mark.
        await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/payments/${paymentId}/refund`)
            .set(...c.ownerActor.auth)
            .expect(201)
        expect(await registrationRow(reg.id)).toMatchObject({
            isPaid: true,
            paymentMethod: 'CASH',
        })
        expect(await revenue30d(c)).toBe(before + 1500)
    })

    it('staff marking a ticket paid waits for the event lock the webhook takes', async () => {
        const c = await club()
        const m = await member(c)
        const event = await createEvent(c, 3)
        const reg = (await register(c, m.actor, event.id)).body as { id: string }
        let mark: Promise<{ status: number; body: { paymentMethod: string } }> | undefined
        await ctx.prisma.$transaction(
            async (tx) => {
                await tx.$queryRaw`SELECT 1 FROM "WorkspaceEvent" WHERE "id" = ${event.id}::uuid FOR UPDATE`
                mark = ctx
                    .http()
                    .post(`/workspaces/${c.workspace.id}/event-registrations/${reg.id}/payment`)
                    .set(...c.ownerActor.auth)
                    .send({ method: 'CASH' })
                    .then((r) => r)
                await waitForLockWaiter('WorkspaceEvent')
            },
            { timeout: 20_000 },
        )
        const marked = await mark
        expect(marked?.status).toBe(201)
        expect(marked?.body.paymentMethod).toBe('CASH')
    })
})
