import { LEAD_CONSENT_VERSION } from '../../../server/src/domains/leads/lead-consent'
import { signIn } from '../support/actors'
import { createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, resetRateLimits, TestApp } from '../support/test-app'

// «Пробные» public form (docs/design/2026-11-26-leads.md §3.2, §10).
describe('public trial requests', () => {
    let ctx: TestApp

    beforeAll(async () => {
        ctx = await createTestApp({ rateLimiting: true })
    })
    afterAll(async () => {
        await ctx?.close()
    })
    beforeEach(async () => {
        await resetDatabase(ctx.prisma)
        await ctx.seed.onApplicationBootstrap()
        await resetRateLimits(ctx)
    })

    const body = (o: Record<string, unknown> = {}) => ({
        name: 'Анна Смирнова',
        phone: '+7 952 884-94-20',
        forChild: true,
        childName: 'Маша',
        childAge: 8,
        comment: 'Хотим в субботу',
        source: 'qr',
        consent: true,
        consentVersion: LEAD_CONSENT_VERSION,
        ...o,
    })

    // An unlisted club with a public address.
    const setup = async () => {
        const { workspace, owner } = await createWorkspace(ctx, { ownerMembership: false })
        await ctx.prisma.workspacePublicSlug.create({ data: { workspaceId: workspace.id, slug: 'trial-club' } })
        return { w: workspace.id, owner, ownerActor: await signIn(ctx, owner.email!) }
    }
    type Club = Awaited<ReturnType<typeof setup>>
    const profile = (c: Club, data: Record<string, unknown>) =>
        ctx
            .http()
            .put(`/workspaces/${c.w}/public-profile`)
            .set(...c.ownerActor.auth)
            .send({ slug: 'trial-club', city: null, description: null, logoKey: null, isListed: false, ...data })
    const acceptDpa = (c: Club, dpaVersion: string) =>
        ctx.prisma.clubLegalAcceptance.create({
            data: { workspaceId: c.w, userId: c.owner.id, offerVersion: '2026-11-01', dpaVersion, source: 'OWNER' },
        })
    const enable = async (c: Club) => {
        await acceptDpa(c, '2026-12-01')
        await profile(c, {
            trialRequestsEnabled: true,
            pdOperatorName: 'ИП Орлов',
            pdOperatorAddress: 'г. Москва, ул. Примерная, 1',
        }).expect(200)
    }
    const form = () => ctx.http().get('/public/clubs/trial-club/trial')
    const submit = (b: Record<string, unknown>, ip = '203.0.113.5') =>
        ctx.http().post('/public/clubs/trial-club/trial').set('X-Forwarded-For', ip).send(b)

    it('form 404 until enabled with an operator and the new DPA', async () => {
        const c = await setup()
        await form().expect(404)

        const noOperator = await profile(c, { trialRequestsEnabled: true }).expect(400)
        expect(noOperator.body.message).toBe('Укажите оператора персональных данных — название и адрес')

        await acceptDpa(c, '2026-11-01')
        const oldDpa = await profile(c, {
            trialRequestsEnabled: true,
            pdOperatorName: 'ИП Орлов',
            pdOperatorAddress: 'г. Москва',
        }).expect(400)
        expect(oldDpa.body.message).toMatch(/новую редакцию поручения/)
        await form().expect(404)

        await enable(c)
        const res = await form().expect(200)
        expect(res.body).toMatchObject({
            operator: { name: 'ИП Орлов', address: 'г. Москва, ул. Примерная, 1' },
            consentVersion: LEAD_CONSENT_VERSION,
            isListed: false,
        })
        const p = await ctx.http().get(`/workspaces/${c.w}/public-profile`).set(...c.ownerActor.auth).expect(200)
        expect(p.body).toMatchObject({ trialRequestsEnabled: true, leadsDpaAccepted: true })
    })

    it('request lands as NEW with consent evidence', async () => {
        const c = await setup()
        await enable(c)
        await submit(body(), '203.0.113.9').set('User-Agent', 'TrialSpec/1.0').expect(201, { status: 'received' })

        const lead = await ctx.prisma.lead.findFirstOrThrow({ where: { workspaceId: c.w } })
        expect(lead).toMatchObject({
            source: 'QR',
            status: 'NEW',
            phone: '+79528849420',
            childName: 'Маша',
            childAge: 8,
            consentVersion: LEAD_CONSENT_VERSION,
            consentUserAgent: 'TrialSpec/1.0',
            createdById: null,
        })
        expect(lead.consentIp).toBeTruthy()
        const audit = await ctx.prisma.auditEvent.findFirstOrThrow({ where: { action: 'lead.create' } })
        expect(audit.actorId).toBeNull()
        expect(JSON.stringify(audit.metadata)).not.toMatch(/Анна|952|Маша/)
        // The owner gets an inbox entry without personal data.
        const notes = await ctx.prisma.notification.findMany({ where: { userId: c.owner.id, type: 'PUSH' } })
        expect(notes.map((n) => n.topic)).toContain('Новая заявка на пробное')
        // Content only: random ids can contain «952».
        expect(JSON.stringify(notes.map((n) => [n.topic, n.message, n.metadata]))).not.toMatch(/Анна|952|Маша|субботу/)

        // Consent missing or outdated, a bad phone: 400 and nothing stored.
        await submit(body({ consent: false, phone: '+7 900 111-22-33' })).expect(400)
        await submit(body({ consentVersion: '2026-01-01', phone: '+7 900 111-22-33' })).expect(400)
        await submit(body({ phone: '12345' })).expect(400)
        expect(await ctx.prisma.lead.count()).toBe(1)
    })

    it('honeypot and duplicates create nothing new', async () => {
        const c = await setup()
        await enable(c)
        await submit(body({ website: 'http://spam.example' }), '203.0.113.20').expect(201, { status: 'received' })
        expect(await ctx.prisma.lead.count()).toBe(0)

        await submit(body(), '203.0.113.21').set('User-Agent', 'First/1.0').expect(201)
        await submit(body({ comment: 'А в воскресенье можно?', phone: '8 952 884 94 20' }), '203.0.113.22')
            .set('User-Agent', 'Second/1.0')
            .expect(201, {
            status: 'received',
        })
        const leads = await ctx.prisma.lead.findMany({ where: { workspaceId: c.w } })
        expect(leads).toHaveLength(1)
        expect(leads[0].resubmittedAt).not.toBeNull()
        // The first consent evidence stays; the repeat is only marked.
        expect(leads[0].consentUserAgent).toBe('First/1.0')
        expect(leads[0].consentAt.getTime()).toBeLessThan(leads[0].resubmittedAt!.getTime())
        expect(leads[0].comment).toMatch(/Хотим в субботу\n\d{2}\.\d{2}\.\d{4}: А в воскресенье можно\?/)
        // One push per recipient only: the merge sends none.
        expect(await ctx.prisma.notification.count({ where: { userId: c.owner.id, type: 'PUSH' } })).toBe(1)
    })

    it('IP throttle answers 429', async () => {
        const c = await setup()
        await enable(c)
        const statuses: number[] = []
        for (let i = 0; i < 11; i++) {
            const res = await submit(body({ phone: `+7 900 000-00-${String(10 + i)}` }), '198.51.100.7')
            statuses.push(res.status)
        }
        expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true)
        expect(statuses[10]).toBe(429)
        // Exactly the ten accepted requests are stored.
        expect(await ctx.prisma.lead.count({ where: { workspaceId: c.w } })).toBe(10)
    })
})
