import { signIn } from '../support/actors'
import { addMember, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const HOUR_MS = 3600_000

// A paid event ticket (a master class) is a sale: the dashboard, revenue.csv
// and the AI revenue report count it once, from the «paid» mark; taking the
// mark back takes it out of all three.
describe('event tickets in revenue', () => {
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
    })

    const wall = (d: Date) => d.toISOString().slice(0, 16)

    it('a marked ticket is one revenue row; unmarking drops it', async () => {
        const { workspace, owner } = await createWorkspace(ctx)
        const ownerActor = await signIn(ctx, owner.email as string)
        const plan = await createPlan(ctx, { workspaceId: workspace.id, name: '8 занятий', classCount: 8 })
        const { user } = await addMember(ctx, { workspaceId: workspace.id })
        await ctx
            .http()
            .post(`/workspaces/${workspace.id}/members/${user.id}/subscription`)
            .set(...ownerActor.auth)
            .send({ planId: plan.id, amountPaid: 4000, paid: true })
            .expect(201)
        const memberActor = await signIn(ctx, user.email as string)

        const start = new Date(Date.now() + 2 * 24 * HOUR_MS)
        const event = await ctx
            .http()
            .post(`/workspaces/${workspace.id}/events`)
            .set(...ownerActor.auth)
            .send({
                title: 'Мастер-класс по растяжке',
                startAt: wall(start),
                endAt: wall(new Date(start.getTime() + 2 * HOUR_MS)),
                timezone: 'UTC',
                price: 1500,
            })
            .expect(201)
        const reg = await ctx
            .http()
            .post(`/workspaces/${workspace.id}/events/${event.body.id}/registrations`)
            .set(...memberActor.auth)
            .expect(201)

        const csv = () =>
            ctx
                .http()
                .get(`/workspaces/${workspace.id}/exports/revenue.csv`)
                .set(...ownerActor.auth)
                .expect(200)
                .then((r) => r.text.split(/\r?\n/).filter((l) => l.includes('Мастер-класс')))
        const stats = () =>
            ctx
                .http()
                .get(`/workspaces/${workspace.id}/stats`)
                .set(...ownerActor.auth)
                .expect(200)
                .then((r) => r.body.revenue.revenue30d as number)

        const before = await stats()
        expect(await csv()).toEqual([])

        await ctx
            .http()
            .post(`/workspaces/${workspace.id}/event-registrations/${reg.body.id}/payment`)
            .set(...ownerActor.auth)
            .send({ method: 'TRANSFER' })
            .expect(201)
        // A second tap does not sell the ticket twice.
        await ctx
            .http()
            .post(`/workspaces/${workspace.id}/event-registrations/${reg.body.id}/payment`)
            .set(...ownerActor.auth)
            .send({ method: 'TRANSFER' })

        const rows = await csv()
        expect(rows).toHaveLength(1)
        expect(rows[0]).toContain(`;${user.email};Мастер-класс по растяжке;1500;RUB;;;Событие;Перевод`)
        expect(await stats()).toBe(before + 1500)

        await ctx
            .http()
            .delete(`/workspaces/${workspace.id}/event-registrations/${reg.body.id}/payment`)
            .set(...ownerActor.auth)
            .expect(200)
        expect(await csv()).toEqual([])
        expect(await stats()).toBe(before)
    })
})
