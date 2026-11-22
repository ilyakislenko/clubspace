import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { type Actor, signIn } from '../support/actors'
import { addMember, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// «Абонементы → Скидки» (docs/design/2026-11-15-discounts.md §3.2): club
// money — owner and admins define discounts; selling roles only read the sale
// options. Real Postgres for the unique code, the FK Restrict and the audit.
describe('discounts: definitions', () => {
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
        const { user: headCoach } = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.HEAD_COACH,
        })
        const { user: student } = await addMember(ctx, { workspaceId: workspace.id })
        const plan = await createPlan(ctx, { workspaceId: workspace.id, name: 'Безлимит', price: 4000, classCount: null })
        const other = await createPlan(ctx, { workspaceId: workspace.id, name: '8 занятий', price: 3000 })
        const ownerActor = await signIn(ctx, owner.email)
        const headActor = await signIn(ctx, headCoach.email as string)
        return { workspace, owner, student, plan, other, ownerActor, headActor }
    }

    const api = (actor: Actor) => ({
        list: (workspaceId: string, query: Record<string, string> = {}) =>
            ctx.http().get(`/workspaces/${workspaceId}/discounts`).query(query).set(...actor.auth),
        create: (workspaceId: string, body: Record<string, unknown>) =>
            ctx.http().post(`/workspaces/${workspaceId}/discounts`).set(...actor.auth).send(body),
        update: (workspaceId: string, id: string, body: Record<string, unknown>) =>
            ctx.http().patch(`/workspaces/${workspaceId}/discounts/${id}`).set(...actor.auth).send(body),
        remove: (workspaceId: string, id: string) =>
            ctx.http().delete(`/workspaces/${workspaceId}/discounts/${id}`).set(...actor.auth),
        options: (workspaceId: string, userId: string) =>
            ctx.http().get(`/workspaces/${workspaceId}/members/${userId}/sale-discounts`).set(...actor.auth),
    })

    it('owner creates, edits, archives and restores a discount; the audit tells the story', async () => {
        const s = await setup()
        const owner = api(s.ownerActor)

        const created = await owner.create(s.workspace.id, {
            name: 'Весна',
            kind: 'FIXED',
            value: 500,
            currency: 'rub',
            code: 'весна',
            allPlans: false,
            planIds: [s.plan.id],
            endsOn: '2099-03-31',
        })
        expect(created.status).toBe(201)
        expect(created.body).toMatchObject({
            name: 'Весна',
            kind: 'FIXED',
            value: 500,
            currency: 'RUB',
            code: 'ВЕСНА',
            allPlans: false,
            plans: [{ id: s.plan.id, name: 'Безлимит' }],
            endsOn: '2099-03-31',
            status: 'active',
            uses: 0,
            given: [],
        })
        const id = created.body.id as string

        // A taken code (P2002 → typed 400), a second family discount.
        expect((await owner.create(s.workspace.id, { name: 'Весна-2', kind: 'PERCENT', value: 5, code: 'ВЕСНА' })).body.message).toBe(
            'Такой промокод уже есть',
        )
        const family = await owner.create(s.workspace.id, { name: 'Семейная', kind: 'PERCENT', value: 10, isFamily: true })
        expect(family.status).toBe(201)
        const second = await owner.create(s.workspace.id, { name: 'Семья-2', kind: 'PERCENT', value: 5, isFamily: true })
        expect(second.status).toBe(400)
        expect(second.body.message).toBe('В клубе уже есть семейная скидка «Семейная»')
        // The superRefine matrix answers in words.
        const bad = await owner.create(s.workspace.id, { name: 'Много', kind: 'PERCENT', value: 150 })
        expect(bad.status).toBe(400)
        expect(JSON.stringify(bad.body)).toContain('Процент скидки — от 1 до 100')

        // Edit with the version the form opened; a stale one is a 409.
        const edited = await owner.update(s.workspace.id, id, {
            value: 700,
            expectedUpdatedAt: created.body.updatedAt,
        })
        expect(edited.status).toBe(200)
        expect(edited.body.value).toBe(700)
        const stale = await owner.update(s.workspace.id, id, {
            value: 800,
            expectedUpdatedAt: created.body.updatedAt,
        })
        expect(stale.status).toBe(409)

        const archived = await owner.update(s.workspace.id, id, { isActive: false })
        expect(archived.body).toMatchObject({ isActive: false, status: 'archived' })
        expect((await owner.list(s.workspace.id)).body.data.map((d: { name: string }) => d.name)).toEqual(['Семейная'])
        expect(
            (await owner.list(s.workspace.id, { archived: 'true' })).body.data.map((d: { name: string }) => d.name),
        ).toEqual(['Семейная', 'Весна'])
        const restored = await owner.update(s.workspace.id, id, { isActive: true })
        expect(restored.body.status).toBe('active')

        const actions = await ctx.prisma.auditEvent.findMany({
            where: { workspaceId: s.workspace.id, targetType: 'discount' },
            orderBy: { createdAt: 'asc' },
            select: { action: true, metadata: true, actorId: true },
        })
        expect(actions.map((a) => a.action)).toEqual([
            'discount.create',
            'discount.create',
            'discount.update',
            'discount.archive',
            'discount.restore',
        ])
        expect(actions[2].metadata).toEqual({ name: 'Весна', changes: { value: { from: 500, to: 700 } } })
        expect(actions.every((a) => a.actorId === s.owner.id)).toBe(true)
    })

    it('the head coach may not define discounts (403) but reads the sale options', async () => {
        const s = await setup()
        const head = api(s.headActor)
        const created = await head.create(s.workspace.id, { name: 'Своя', kind: 'PERCENT', value: 50 })
        expect(created.status).toBe(403)
        expect((await head.list(s.workspace.id)).status).toBe(403)
        await api(s.ownerActor).create(s.workspace.id, { name: 'Студенческая', kind: 'PERCENT', value: 15 })
        const options = await head.options(s.workspace.id, s.student.id)
        expect(options.status).toBe(200)
        expect(options.body.familyEligible).toBe(false)
        expect(options.body.options).toEqual([
            expect.objectContaining({
                name: 'Студенческая',
                items: expect.arrayContaining([
                    { planId: s.plan.id, eventId: null, listPrice: 4000, amount: 3400, currency: 'RUB' },
                    { planId: s.other.id, eventId: null, listPrice: 3000, amount: 2550, currency: 'RUB' },
                ]),
            }),
        ])
        expect(options.body).not.toHaveProperty('canSetAmount')
    })

    it('archiving hides a discount from the sale form; a used one cannot be deleted', async () => {
        const s = await setup()
        const owner = api(s.ownerActor)
        const unused = await owner.create(s.workspace.id, { name: 'Пробная', kind: 'PERCENT', value: 5 })
        expect((await owner.remove(s.workspace.id, unused.body.id)).body).toEqual({ status: 'deleted' })

        const d = await owner.create(s.workspace.id, { name: 'Студенческая', kind: 'PERCENT', value: 15 })
        const sold = await ctx
            .http()
            .post(`/workspaces/${s.workspace.id}/members/${s.student.id}/subscription`)
            .set(...s.ownerActor.auth)
            .send({ planId: s.plan.id, discountId: d.body.id })
        expect(sold.status).toBe(201)
        expect(sold.body.subscription).toMatchObject({ amountPaid: 3400, discountName: 'Студенческая', discountAmount: 600 })

        const refused = await owner.remove(s.workspace.id, d.body.id)
        expect(refused.status).toBe(400)
        expect(refused.body.message).toBe('Скидкой уже пользовались — уберите её в архив')

        const listed = await owner.list(s.workspace.id)
        expect(listed.body.data[0]).toMatchObject({ uses: 1, given: [{ currency: 'RUB', amount: 600 }] })

        await owner.update(s.workspace.id, d.body.id, { isActive: false })
        expect((await api(s.headActor).options(s.workspace.id, s.student.id)).body.options).toEqual([])
        // The past sale keeps its label.
        const row = await ctx.prisma.subscription.findUniqueOrThrow({ where: { id: sold.body.subscription.id } })
        expect(row).toMatchObject({ discountName: 'Студенческая', discountAmount: 600, listPrice: 4000 })
    })
})
