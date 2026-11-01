import { quoteWorkspaceBilling } from '../../../server/src/domains/billing/quote-workspace-billing'
import { environment } from '../../../server/src/environments/environment'
import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn } from '../support/actors'
import { addMember, createWorkspace } from '../support/fixtures'
import {
    createTestApp,
    resetDatabase,
    resetRateLimits,
    TestApp,
} from '../support/test-app'

const PLATFORM_OWNER = 'platform-owner@clubspace.test'

const DEMO = {
    name: 'Илья',
    clubName: 'Академия единоборств',
    city: 'Томск',
    contact: '@ilya_club',
    studentsCount: 350,
    comment: 'Десять залов, БЖЖ и тайский бокс',
    consent: true,
}

// The public landing (app.<domain>/): its price list and calculator read the
// billing config every club's bill is computed from, and its «Показать демо»
// form drops leads into the platform console — which nobody but the platform
// operator may read.
describe('landing: public pricing', () => {
    let ctx: TestApp

    beforeAll(async () => {
        ctx = await createTestApp()
    })
    afterAll(async () => {
        await ctx?.close()
    })

    it('serves the billing config without signing in', async () => {
        const { pricing, trialDays } = environment.billing
        const res = await ctx.http().get('/public/pricing').expect(200)

        expect(res.body).toEqual({
            currency: pricing.currency,
            trialDays,
            setupFee: pricing.setupFee,
            annualDiscountPercent: pricing.annualDiscountPercent,
            tiers: pricing.tiers,
            modules: pricing.modules,
        })
    })

    // List prices for a club that is not a customer: no custom price, no
    // discount, no usage — exactly what quoteWorkspaceBilling charges a new
    // club after its trial (first payment with the setup fee, renewals without).
    it.each([
        { activeMembers: 40, modules: [] as string[], periodMonths: 1 },
        { activeMembers: 180, modules: ['VIDEO'], periodMonths: 1 },
        {
            activeMembers: 450,
            modules: ['VIDEO', 'ONLINE_PAYMENTS', 'BRANDED_APP'],
            periodMonths: 12,
        },
    ])('quotes %j with the billing quote math', async (input) => {
        const res = await ctx
            .http()
            .post('/public/pricing/quote')
            .send(input)
            .expect(200)

        const base = {
            pricing: environment.billing.pricing,
            activeMembers: input.activeMembers,
            periodStart: new Date(),
            periodMonths: input.periodMonths,
            subscription: {
                customMonthlyPrice: null,
                discountPercent: 0,
                discountUntil: null,
                freeUntil: null,
            },
            modules: input.modules.map((code) => ({
                code: code as 'VIDEO',
                mode: 'PAID' as const,
                compUntil: null,
                customPrice: null,
            })),
            usage: { storageBytes: 0, viewedSeconds: 0 },
        }
        const first = quoteWorkspaceBilling({
            ...base,
            setupFee: { waived: false, paid: false },
        })
        const renewal = quoteWorkspaceBilling({
            ...base,
            setupFee: { waived: false, paid: true },
        })

        expect(res.body.quote).toEqual(first)
        expect(res.body.renewal).toBe(renewal.total)
        expect(res.body.perMonth).toBe(
            Math.round(renewal.total / input.periodMonths),
        )
        expect(res.body.quote.lines.at(-1)).toMatchObject({
            code: 'setup',
            amount: environment.billing.pricing.setupFee,
        })
    })

    it('prices the «Сеть» tier per member over 400 with the annual discount', async () => {
        const res = await ctx
            .http()
            .post('/public/pricing/quote')
            .send({ activeMembers: 450, modules: ['VIDEO'], periodMonths: 12 })
            .expect(200)

        const network = environment.billing.pricing.tiers.at(-1)!
        const video = environment.billing.pricing.modules.find(
            (m) => m.code === 'VIDEO',
        )!
        const recurring =
            (network.priceMonthly + network.extraMemberPrice * 50 + video.priceMonthly) * 12
        const annual = Math.round(
            (recurring * environment.billing.pricing.annualDiscountPercent) / 100,
        )
        expect(res.body.quote.tierCode).toBe(network.code)
        expect(res.body.renewal).toBe(recurring - annual)
        expect(res.body.quote.total).toBe(
            recurring - annual + environment.billing.pricing.setupFee,
        )
    })

    it('refuses a period other than a month or a year', async () => {
        await ctx
            .http()
            .post('/public/pricing/quote')
            .send({ activeMembers: 10, periodMonths: 3 })
            .expect(400)
    })
})

describe('landing: demo requests', () => {
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

    it('stores a request and e-mails the platform owner', async () => {
        await ctx
            .http()
            .post('/public/demo-requests')
            .send(DEMO)
            .expect(201, { status: 'received' })

        const rows = await ctx.prisma.demoRequest.findMany()
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({
            name: DEMO.name,
            clubName: DEMO.clubName,
            city: DEMO.city,
            contact: DEMO.contact,
            studentsCount: DEMO.studentsCount,
            comment: DEMO.comment,
        })
        expect(rows[0].consentAt).toBeInstanceOf(Date)

        const mail = await ctx.mail.waitFor((m) => m.to === PLATFORM_OWNER)
        expect(mail.subject).toBe(`Заявка на демо: ${DEMO.clubName}`)
        expect(mail.html).toContain(DEMO.contact)
    })

    it('refuses a request without consent to process the contacts', async () => {
        const res = await ctx
            .http()
            .post('/public/demo-requests')
            .send({ ...DEMO, consent: false })
            .expect(400)
        expect(res.body.message).toBe(
            'Нужно согласие на обработку контактных данных',
        )
        expect(await ctx.prisma.demoRequest.count()).toBe(0)
    })

    it('answers a bot that filled the honeypot and stores nothing', async () => {
        await ctx
            .http()
            .post('/public/demo-requests')
            .send({ ...DEMO, website: 'https://spam.example' })
            .expect(201, { status: 'received' })
        expect(await ctx.prisma.demoRequest.count()).toBe(0)
    })

    it('shows the requests to the platform operator only', async () => {
        await ctx.http().post('/public/demo-requests').send(DEMO).expect(201)

        const admin = await signIn(ctx, PLATFORM_OWNER)
        const listed = await ctx
            .http()
            .get('/platform/demo-requests')
            .set(...admin.auth)
            .expect(200)
        expect(listed.body.data).toHaveLength(1)
        expect(listed.body.data[0]).toMatchObject({
            clubName: DEMO.clubName,
            contact: DEMO.contact,
            studentsCount: DEMO.studentsCount,
        })

        // Owner and admin of a club are still tenants: leads are the
        // platform's sales pipeline, not any club's data.
        const { workspace, owner } = await createWorkspace(ctx)
        const { user: clubAdmin } = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.ADMIN,
        })
        const { user: student } = await addMember(ctx, {
            workspaceId: workspace.id,
        })
        for (const email of [owner.email!, clubAdmin.email!, student.email!]) {
            const actor = await signIn(ctx, email)
            await ctx
                .http()
                .get('/platform/demo-requests')
                .set(...actor.auth)
                .expect(403)
            // Naming their club does not open it either.
            await ctx
                .http()
                .get('/platform/demo-requests')
                .query({ workspaceId: workspace.id })
                .set(...actor.auth)
                .expect(403)
        }

        await ctx.http().get('/platform/demo-requests').expect(401)
    })
})

// Rate limiting needs the real counter store (see auth/throttling.e2e-spec.ts).
describe('landing: demo request rate limiting', () => {
    let ctx: TestApp

    beforeAll(async () => {
        ctx = await createTestApp({ rateLimiting: true })
        await resetRateLimits(ctx)
    })
    afterAll(async () => {
        await resetRateLimits(ctx)
        await ctx?.close()
    })

    it('stops a burst of demo requests from one address', async () => {
        await resetDatabase(ctx.prisma)
        await ctx.seed.onApplicationBootstrap()

        const statuses: number[] = []
        for (let i = 0; i < 7; i++) {
            const res = await ctx
                .http()
                .post('/public/demo-requests')
                .send({ ...DEMO, clubName: `Клуб ${i}` })
            statuses.push(res.status)
        }

        expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201])
        expect(statuses.slice(5)).toEqual([429, 429])
        expect(await ctx.prisma.demoRequest.count()).toBe(5)
    })
})
