import { DataPurgeService } from '../../../server/src/domains/scheduler/data-purge.service'
import { localDateInTz } from '../../../server/src/features/attendance/attendance-utils'
import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn, type Actor } from '../support/actors'
import { addMember, createGroupWithSlot, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const DAY = 24 * 60 * 60_000

// «Ученики → Пробные» (docs/design/2026-11-26-leads.md §3.3, §10).
describe('leads pipeline', () => {
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

    const http = () => ctx.http()

    const setup = async () => {
        const { workspace, owner } = await createWorkspace(ctx, { ownerMembership: false })
        const w = workspace.id
        const member = async (role?: RolesEnum) => {
            const { user } = await addMember(ctx, { workspaceId: w, role })
            return { user, actor: await signIn(ctx, user.email!) }
        }
        const head = await member(RolesEnum.HEAD_COACH)
        const admin = await member(RolesEnum.ADMIN)
        const coach = await member(RolesEnum.COACH)
        const student = await member()
        const group = await createGroupWithSlot(ctx, {
            workspaceId: w,
            coachUserId: coach.user.id,
            dayOfWeek: 5,
            gymTimezone: 'Europe/Moscow',
            name: 'Дети 6–9',
        })
        return { w, owner, ownerActor: await signIn(ctx, owner.email!), head, admin, coach, student, group }
    }
    type Club = Awaited<ReturnType<typeof setup>>

    const base = (c: Club) => `/workspaces/${c.w}/leads`
    const create = (c: Club, actor: Actor, o: Record<string, unknown> = {}) =>
        http()
            .post(base(c))
            .set(...actor.auth)
            .send({
                name: 'Анна Смирнова',
                phone: '+7 952 884-94-20',
                forChild: true,
                childName: 'Маша',
                childAge: 8,
                comment: 'Звонила в клуб',
                consentConfirmed: true,
                ...o,
            })
    const setStatus = (c: Club, actor: Actor, leadId: string, b: Record<string, unknown>) =>
        http().post(`${base(c)}/${leadId}/status`).set(...actor.auth).send(b)

    it('sport lead books a trial and the group coach is notified', async () => {
        const c = await setup()
        const lead = (await create(c, c.head.actor).expect(201)).body
        expect(lead).toMatchObject({ source: 'MANUAL', status: 'NEW', needsAction: true })

        await setStatus(c, c.head.actor, lead.id, {
            from: 'NEW',
            to: 'TRIAL_BOOKED',
            trialAt: '2030-01-11T18:00',
            trialGroupId: c.group.group.id,
            notifyCoach: true,
        }).expect(201)

        const got = (await http().get(`${base(c)}/${lead.id}`).set(...c.admin.actor.auth).expect(200)).body
        expect(got).toMatchObject({
            status: 'TRIAL_BOOKED',
            trialAt: '2030-01-11T15:00:00.000Z',
            trialGroupName: 'Дети 6–9',
        })
        const coachNotes = await ctx.prisma.notification.findMany({ where: { userId: c.coach.user.id, type: 'PUSH' } })
        expect(coachNotes).toHaveLength(1)
        expect(coachNotes[0]).toMatchObject({ topic: 'На пробное придёт новый человек' })
        expect(coachNotes[0].message).toContain('18:00 · «Дети 6–9»')
        // Content only: random ids can contain «952».
        expect(JSON.stringify(coachNotes.map((n) => [n.topic, n.message, n.metadata]))).not.toMatch(/Анна|Маша|952/)
        // The student and the other staff got no heads-up about the trial.
        expect(
            await ctx.prisma.notification.count({
                where: { metadata: { path: ['kind'], equals: 'lead.trialBooked' } },
            }),
        ).toBe(1)
        const audit = await ctx.prisma.auditEvent.findMany({ where: { targetId: lead.id } })
        expect(audit.map((a) => a.action).sort()).toEqual(['lead.create', 'lead.setStatus'])
        expect(JSON.stringify(audit.map((a) => a.metadata))).not.toMatch(/Анна|Маша|952|Звонила/)

        // A manual duplicate points at the open lead.
        const dup = await create(c, c.admin.actor, { phone: '89528849420' }).expect(409)
        expect(dup.body).toMatchObject({ code: 'LEAD_DUPLICATE', metadata: { leadId: lead.id } })
    })

    it('adding the lead to the club and selling an abonement shows bought', async () => {
        const c = await setup()
        const lead = (await create(c, c.ownerActor).expect(201)).body
        await setStatus(c, c.ownerActor, lead.id, { from: 'NEW', to: 'CAME' }).expect(201)

        await http().post(`${base(c)}/${lead.id}/link`).set(...c.ownerActor.auth).send({ userId: c.coach.user.id }).expect(400)
        const linked = (
            await http().post(`${base(c)}/${lead.id}/link`).set(...c.ownerActor.auth).send({ userId: c.student.user.id }).expect(201)
        ).body
        expect(linked).toMatchObject({ convertedUserId: c.student.user.id, displayStatus: 'CAME' })
        // Again with the same student: idempotent; another student: 409.
        await http().post(`${base(c)}/${lead.id}/link`).set(...c.ownerActor.auth).send({ userId: c.student.user.id }).expect(201)
        const other = await addMember(ctx, { workspaceId: c.w })
        await http().post(`${base(c)}/${lead.id}/link`).set(...c.ownerActor.auth).send({ userId: other.user.id }).expect(409)

        // Linked, nothing paid yet: «Пришёл», not «Купил».
        const linkedOnly = (await http().get(`${base(c)}/${lead.id}`).set(...c.ownerActor.auth).expect(200)).body
        expect(linkedOnly.displayStatus).toBe('CAME')

        const plan = await createPlan(ctx, { workspaceId: c.w, price: 4000 })
        await http()
            .post(`/workspaces/${c.w}/members/${c.student.user.id}/subscription`)
            .set(...c.ownerActor.auth)
            .send({ planId: plan.id, amountPaid: 4000, paymentMethod: 'CASH' })
            .expect(201)
        const bought = (await http().get(`${base(c)}/${lead.id}`).set(...c.ownerActor.auth).expect(200)).body
        expect(bought).toMatchObject({ status: 'CAME', displayStatus: 'BOUGHT' })
        const list = (await http().get(base(c)).query({ view: 'bought' }).set(...c.ownerActor.auth).expect(200)).body
        expect(list.data.map((l: { id: string }) => l.id)).toEqual([lead.id])
        expect(list.counts).toMatchObject({ bought: 1, came: 0 })

        const today = localDateInTz(new Date(), 'Europe/Moscow')
        const report = (await http().get(`${base(c)}/report`).query({ to: today }).set(...c.head.actor.auth).expect(200)).body
        expect(report.total).toMatchObject({ received: 1, came: 1, bought: 1 })
        expect(report.bySource.find((s: { source: string }) => s.source === 'MANUAL')).toMatchObject({ bought: 1 })
    })

    it('two staff changing the same status: second gets 409', async () => {
        const c = await setup()
        const lead = (await create(c, c.head.actor).expect(201)).body
        const [a, b] = await Promise.all([
            setStatus(c, c.head.actor, lead.id, { from: 'NEW', to: 'CONTACTED' }),
            setStatus(c, c.admin.actor, lead.id, { from: 'NEW', to: 'LOST', lostReason: 'CHANGED_MIND' }),
        ])
        expect([a.status, b.status].sort()).toEqual([201, 409])
        const loser = a.status === 409 ? a : b
        expect(loser.body.message).toBe('Статус заявки изменился — обновите экран')
    })

    it('coach gets 403 on leads routes', async () => {
        const c = await setup()
        const lead = (await create(c, c.head.actor).expect(201)).body
        const auth = c.coach.actor.auth
        await http().get(base(c)).set(...auth).expect(403)
        await http().get(`${base(c)}/${lead.id}`).set(...auth).expect(403)
        await http().get(`${base(c)}/report`).set(...auth).expect(403)
        await http().get(`${base(c)}/trial-link`).set(...auth).expect(403)
        await create(c, c.coach.actor, { phone: '+7 900 111-22-33' }).expect(403)
        await setStatus(c, c.coach.actor, lead.id, { from: 'NEW', to: 'CONTACTED' }).expect(403)
        await http().post(`${base(c)}/${lead.id}/erase`).set(...auth).expect(403)
        await http().get(`/workspaces/${c.w}/exports/leads.csv`).set(...c.head.actor.auth).expect(403)
        const csv = await http().get(`/workspaces/${c.w}/exports/leads.csv`).set(...c.admin.actor.auth).expect(200)
        expect(csv.text).toContain('Получена;Источник;Статус')
    })

    it('lost lead is anonymised after 90 days, report still counts it', async () => {
        const c = await setup()
        const lead = (await create(c, c.head.actor).expect(201)).body
        await setStatus(c, c.head.actor, lead.id, { from: 'NEW', to: 'LOST', lostReason: 'PRICE' }).expect(201)
        const lostAt = (await ctx.prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).lostAt as Date

        const purge = ctx.app.get(DataPurgeService)
        await purge.purgeLeads(new Date(lostAt.getTime() + 89 * DAY))
        expect((await ctx.prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).phone).not.toBeNull()

        const res = await purge.purgeLeads(new Date(lostAt.getTime() + 91 * DAY))
        expect(res.leadsAnonymized).toBe(1)
        const row = await ctx.prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })
        expect(row).toMatchObject({ name: null, phone: null, childName: null, comment: null, status: 'LOST', lostReason: 'PRICE' })
        expect(row.anonymizedAt).not.toBeNull()

        const today = localDateInTz(new Date(), 'Europe/Moscow')
        const report = (await http().get(`${base(c)}/report`).query({ to: today }).set(...c.head.actor.auth).expect(200)).body
        expect(report.total).toMatchObject({ received: 1, lostByReason: [{ reason: 'PRICE', count: 1 }] })
        // Shown under «Отказ», not under «Нужно действие».
        const lost = (await http().get(base(c)).query({ view: 'lost' }).set(...c.head.actor.auth).expect(200)).body
        expect(lost.data[0]).toMatchObject({ id: lead.id, name: null, phone: null })
    })

    it('erase removes personal data at once', async () => {
        const c = await setup()
        const lead = (await create(c, c.admin.actor).expect(201)).body
        const erased = (await http().post(`${base(c)}/${lead.id}/erase`).set(...c.admin.actor.auth).expect(201)).body
        expect(erased).toMatchObject({ name: null, phone: null, email: null, childName: null, comment: null, source: 'MANUAL' })
        const row = await ctx.prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })
        expect(row).toMatchObject({ name: null, phone: null, consentIp: null })
        const audit = await ctx.prisma.auditEvent.findFirstOrThrow({ where: { action: 'lead.erase' } })
        expect(audit.metadata).toEqual({})
        await setStatus(c, c.admin.actor, lead.id, { from: 'NEW', to: 'CONTACTED' }).expect(400)
    })
})
