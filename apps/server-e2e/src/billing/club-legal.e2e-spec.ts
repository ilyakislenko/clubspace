import type {
    CreateGatewayPaymentInput,
    GatewayCredentials,
    GatewayPayment,
} from '../../../server/src/domains/payments/payment-gateway.types'
import { environment } from '../../../server/src/environments/environment'
import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { type Actor, signIn } from '../support/actors'
import { addMember, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const PLATFORM_OWNER = 'platform-owner@clubspace.test'
const DAY = 86_400_000
const DEFAULT_VERSION = '2026-11-01'

// An edition dated `days` from today (UTC): the grace counts from that date.
const editionDated = (days: number) =>
    new Date(Date.now() + days * DAY).toISOString().slice(0, 10)

// The platform's YooKassa shop at the PaymentGatewayClient boundary: every
// redirect payment waits on its page. Everything else is real.
class FakePlatformGateway {
    private seq = 0
    private byKey = new Map<string, GatewayPayment>()

    reset() {
        this.seq = 0
        this.byKey.clear()
    }

    createPayment = async (
        _creds: GatewayCredentials,
        input: CreateGatewayPaymentInput,
    ): Promise<GatewayPayment> => {
        const known = this.byKey.get(input.idempotenceKey)
        if (known) return known
        const id = `yk_legal_${++this.seq}`
        const payment: GatewayPayment = {
            providerPaymentId: id,
            status: 'PENDING',
            confirmationUrl: `https://yookassa.test/confirm/${id}`,
            amountMinor: input.amount * 100,
            currency: input.currency,
            paymentMethod: null,
            cancellationReason: null,
        }
        this.byKey.set(input.idempotenceKey, payment)
        return payment
    }

    getPayment = async (): Promise<GatewayPayment> => {
        throw new Error('not used')
    }

    refund = async () => undefined

    checkConnection = async () => ({ accountId: '500500', testMode: true })
}

// The platform's contract with clubs end to end: the offer + DPA editions a
// club owner accepts at self-serve sign-up, from the console, on the first
// card payment or on the «Тариф» page; a new edition's grace, after which the
// club's paid actions are refused until the owner — and only the owner —
// accepts; clubs never see or touch each other's acceptance.
describe('club legal acceptance', () => {
    let ctx: TestApp
    const gateway = new FakePlatformGateway()
    let adminAuth: [string, string] | null = null
    const saved = { ...environment.billing.legal }

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
        adminAuth = null
    })
    afterEach(() => {
        Object.assign(environment.billing.legal, saved)
        environment.billing.selfServeSignupEnabled = true
    })

    const platformAdmin = async () => {
        adminAuth ??= (await signIn(ctx, PLATFORM_OWNER)).auth
        return adminAuth
    }

    // A club created behind the platform's back (no acceptance on record),
    // `ageDays` old, past due so a checkout has something to charge.
    const club = async (o: { ageDays?: number } = {}) => {
        const { workspace, owner } = await createWorkspace(ctx, { name: 'Клуб «Оферта»' })
        if (o.ageDays) {
            await ctx.prisma.workspace.update({
                where: { id: workspace.id },
                data: { createdAt: new Date(Date.now() - o.ageDays * DAY) },
            })
        }
        const trialEnd = new Date(Date.now() - 3 * DAY)
        await ctx.prisma.workspaceBilling.create({
            data: {
                workspaceId: workspace.id,
                status: 'PAST_DUE',
                trialEndsAt: trialEnd,
                pastDueSince: trialEnd,
            },
        })
        const actor = await signIn(ctx, owner.email)
        return { workspace, owner, actor }
    }

    const legalOf = async (workspaceId: string, actor: Actor) =>
        (
            await ctx
                .http()
                .get(`/workspaces/${workspaceId}/billing`)
                .set(...actor.auth)
                .expect(200)
        ).body.legal

    const accept = (
        workspaceId: string,
        auth: [string, string],
        versions = {
            offerVersion: environment.billing.legal.offerVersion,
            dpaVersion: environment.billing.legal.dpaVersion,
        },
    ) =>
        ctx
            .http()
            .post(`/workspaces/${workspaceId}/billing/legal`)
            .set(...auth)
            .send(versions)

    const checkout = (workspaceId: string, actor: Actor) =>
        ctx
            .http()
            .post(`/workspaces/${workspaceId}/billing/checkout`)
            .set(...actor.auth)
            .send({ periodMonths: 1 })

    const acceptances = (workspaceId: string) =>
        ctx.prisma.clubLegalAcceptance.findMany({
            where: { workspaceId },
            orderBy: { acceptedAt: 'asc' },
        })

    it('publishes the editions and the seller requisites for /legal/*', async () => {
        const res = await ctx.http().get('/public/legal').expect(200)
        expect(res.body).toMatchObject({
            offerVersion: DEFAULT_VERSION,
            dpaVersion: DEFAULT_VERSION,
            acceptGraceDays: 14,
            seller: { name: null, inn: null, ogrnip: null },
            sellerComplete: false,
        })
    })

    describe('self-serve sign-up', () => {
        it('records the owner’s acceptance of the editions the wizard showed', async () => {
            const config = await ctx.http().get('/self-serve/config').expect(200)
            expect(config.body).toMatchObject({
                offerVersion: DEFAULT_VERSION,
                dpaVersion: DEFAULT_VERSION,
            })

            const founder = await signIn(ctx, 'founder@example.com')
            const res = await ctx
                .http()
                .post('/self-serve/workspaces')
                .set(...founder.auth)
                .set('User-Agent', 'LegalSpec/1.0')
                .send({
                    name: 'Самбо на Лесной',
                    type: 'GRAPPLING',
                    timezone: 'Europe/Moscow',
                    offerVersion: config.body.offerVersion,
                    dpaVersion: config.body.dpaVersion,
                })
                .expect(201)

            const rows = await acceptances(res.body.workspaceId)
            expect(rows).toHaveLength(1)
            expect(rows[0]).toMatchObject({
                userId: founder.userId,
                userEmail: 'founder@example.com',
                source: 'SIGNUP',
                offerVersion: DEFAULT_VERSION,
                dpaVersion: DEFAULT_VERSION,
                userAgent: 'LegalSpec/1.0',
            })
            expect(rows[0].ip).toBeTruthy()

            const legal = await legalOf(res.body.workspaceId, founder)
            expect(legal).toMatchObject({
                upToDate: true,
                required: false,
                acceptBy: null,
                canAccept: true,
                accepted: { source: 'SIGNUP', offerVersion: DEFAULT_VERSION },
            })
        })

        it('refuses an edition that is no longer current and creates nothing', async () => {
            const founder = await signIn(ctx, 'founder@example.com')
            const res = await ctx
                .http()
                .post('/self-serve/workspaces')
                .set(...founder.auth)
                .send({
                    name: 'Клуб',
                    type: 'FITNESS',
                    timezone: 'Europe/Moscow',
                    offerVersion: '2026-01-01',
                    dpaVersion: DEFAULT_VERSION,
                })
            expect(res.status).toBe(409)
            expect(await ctx.prisma.workspace.count()).toBe(0)
            expect(await ctx.prisma.clubLegalAcceptance.count()).toBe(0)
        })
    })

    it('the console records an owner’s offline acceptance and shows the evidence', async () => {
        const auth = await platformAdmin()
        const created = await ctx
            .http()
            .post('/platform/workspaces')
            .set(...auth)
            .send({ name: 'Тайский бокс', ownerEmail: 'boxer@example.com', ownerAcceptedOffer: true })
            .expect(201)
        const workspaceId = created.body.workspace.workspaceId
        const plain = await ctx
            .http()
            .post('/platform/workspaces')
            .set(...auth)
            .send({ name: 'ОФП', ownerEmail: 'ofp@example.com' })
            .expect(201)

        const card = await ctx
            .http()
            .get(`/platform/workspaces/${workspaceId}/billing`)
            .set(...auth)
            .expect(200)
        expect(card.body.legal).toMatchObject({ upToDate: true, required: false })
        expect(card.body.legal.acceptances).toHaveLength(1)
        const platformOwner = await ctx.prisma.user.findUniqueOrThrow({
            where: { email: PLATFORM_OWNER },
        })
        expect(card.body.legal.acceptances[0]).toMatchObject({
            source: 'CONSOLE',
            userEmail: 'boxer@example.com',
            recordedById: platformOwner.id,
            offerVersion: DEFAULT_VERSION,
        })

        // Created without the attestation: nothing on record, the owner gets
        // the full grace from the club's creation.
        const other = await ctx
            .http()
            .get(`/platform/workspaces/${plain.body.workspace.workspaceId}/billing`)
            .set(...auth)
            .expect(200)
        expect(other.body.legal).toMatchObject({ upToDate: false, required: false, accepted: null })
        expect(other.body.legal.acceptances).toEqual([])
    })

    it('the owner’s first card payment accepts the editions, once', async () => {
        const c = await club()
        const first = await checkout(c.workspace.id, c.actor).expect(201)
        // A repeated tap reuses the same payment page.
        const again = await checkout(c.workspace.id, c.actor).expect(201)
        expect(again.body.payment.id).toBe(first.body.payment.id)

        const rows = await acceptances(c.workspace.id)
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({
            source: 'PAYMENT',
            paymentId: first.body.payment.id,
            userId: c.owner.id,
            offerVersion: DEFAULT_VERSION,
        })
        expect((await legalOf(c.workspace.id, c.actor)).upToDate).toBe(true)

        // Another admin paying does not accept for the club.
        const d = await club()
        const { user } = await addMember(ctx, { workspaceId: d.workspace.id, role: RolesEnum.ADMIN })
        const admin = await signIn(ctx, user.email)
        await checkout(d.workspace.id, admin).expect(201)
        expect(await acceptances(d.workspace.id)).toEqual([])
    })

    describe('a new edition', () => {
        it('shows the banner during the grace, then refuses paid actions until the owner accepts', async () => {
            const c = await club({ ageDays: 60 })
            // The edition the owner starts on is dated off today like the newer
            // ones, so "yesterday's" edition can never be this one — a fixed
            // date collides with editionDated(-1) the day after it.
            const first = editionDated(-60)
            environment.billing.legal.offerVersion = first
            await accept(c.workspace.id, c.actor.auth).expect(201)
            expect((await legalOf(c.workspace.id, c.actor)).upToDate).toBe(true)

            // Published yesterday: the owner is told, nothing is refused yet.
            environment.billing.legal.offerVersion = editionDated(-1)
            const pending = await legalOf(c.workspace.id, c.actor)
            expect(pending).toMatchObject({
                offerVersion: editionDated(-1),
                upToDate: false,
                required: false,
                canAccept: true,
                accepted: { offerVersion: first, source: 'OWNER' },
            })
            expect(new Date(pending.acceptBy).getTime()).toBe(
                new Date(`${editionDated(-1)}T00:00:00.000Z`).getTime() + 14 * DAY,
            )
            await checkout(c.workspace.id, c.actor).expect(201)

            // Published 30 days ago and still not accepted: the grace is over.
            environment.billing.legal.offerVersion = editionDated(-30)
            expect(await legalOf(c.workspace.id, c.actor)).toMatchObject({
                upToDate: false,
                required: true,
            })
            const refused = await checkout(c.workspace.id, c.actor).expect(403)
            expect(refused.body.code).toBe('LEGAL_ACCEPTANCE_REQUIRED')
            expect(refused.body.message).toContain('«Тариф»')
            const module = await ctx
                .http()
                .post(`/workspaces/${c.workspace.id}/billing/modules`)
                .set(...c.actor.auth)
                .send({ module: 'BRANDED_APP', enabled: true })
                .expect(403)
            expect(module.body.code).toBe('LEGAL_ACCEPTANCE_REQUIRED')
            const card = await ctx
                .http()
                .post(`/workspaces/${c.workspace.id}/billing/card`)
                .set(...c.actor.auth)
                .expect(403)
            expect(card.body.code).toBe('LEGAL_ACCEPTANCE_REQUIRED')
            // Disconnecting is never a paid action.
            const off = await ctx
                .http()
                .post(`/workspaces/${c.workspace.id}/billing/modules`)
                .set(...c.actor.auth)
                .send({ module: 'BRANDED_APP', enabled: false })
            expect(off.body.code).not.toBe('LEGAL_ACCEPTANCE_REQUIRED')

            // The owner accepts the edition they were shown; paying works again.
            const accepted = await accept(c.workspace.id, c.actor.auth).expect(201)
            expect(accepted.body).toMatchObject({
                upToDate: true,
                required: false,
                accepted: { offerVersion: editionDated(-30), source: 'OWNER' },
            })
            await checkout(c.workspace.id, c.actor).expect(201)
            const rows = await acceptances(c.workspace.id)
            expect(rows.map((r) => [r.source, r.offerVersion])).toEqual([
                ['OWNER', first],
                // Paying during the grace is the first payment: it accepts
                // the edition then current (the offer names payment as
                // acceptance).
                ['PAYMENT', editionDated(-1)],
                ['OWNER', editionDated(-30)],
            ])
        })

        it('gives a club created after the edition the full grace from its creation', async () => {
            environment.billing.legal.dpaVersion = editionDated(-30)
            const c = await club()
            expect(await legalOf(c.workspace.id, c.actor)).toMatchObject({
                upToDate: false,
                required: false,
                accepted: null,
            })
            await checkout(c.workspace.id, c.actor).expect(201)
        })
    })

    describe('only the club owner accepts for the club', () => {
        it('refuses another admin, a coach and a platform admin; refuses a stale edition', async () => {
            const c = await club()
            const { user: adminUser } = await addMember(ctx, {
                workspaceId: c.workspace.id,
                role: RolesEnum.ADMIN,
            })
            const { user: coachUser } = await addMember(ctx, {
                workspaceId: c.workspace.id,
                role: RolesEnum.COACH,
            })
            const admin = await signIn(ctx, adminUser.email)
            const coach = await signIn(ctx, coachUser.email)

            expect((await legalOf(c.workspace.id, admin)).canAccept).toBe(false)
            const byAdmin = await accept(c.workspace.id, admin.auth).expect(403)
            expect(byAdmin.body.message).toContain('только его владелец')
            await accept(c.workspace.id, coach.auth).expect(403)
            await accept(c.workspace.id, await platformAdmin()).expect(403)
            await accept(c.workspace.id, c.actor.auth, {
                offerVersion: '2026-01-01',
                dpaVersion: DEFAULT_VERSION,
            }).expect(409)
            expect(await acceptances(c.workspace.id)).toEqual([])

            await accept(c.workspace.id, c.actor.auth).expect(201)
            // A second tap records nothing new.
            await accept(c.workspace.id, c.actor.auth).expect(201)
            const rows = await acceptances(c.workspace.id)
            expect(rows).toHaveLength(1)
            expect(rows[0]).toMatchObject({ source: 'OWNER', userId: c.owner.id })
        })
    })

    it('keeps clubs apart: an owner cannot accept for, or read, another club', async () => {
        const a = await club()
        const b = await club()

        await accept(a.workspace.id, b.actor.auth).expect(403)
        await ctx
            .http()
            .get(`/workspaces/${a.workspace.id}/billing`)
            .set(...b.actor.auth)
            .expect(403)

        await accept(b.workspace.id, b.actor.auth).expect(201)
        expect(await acceptances(a.workspace.id)).toEqual([])
        expect((await legalOf(a.workspace.id, a.actor)).upToDate).toBe(false)
        expect((await legalOf(b.workspace.id, b.actor)).upToDate).toBe(true)

        // The grace running out in one club refuses nothing in the other.
        // Both editions are new: a club that never accepted counts its grace
        // from the later one's date.
        environment.billing.legal.offerVersion = editionDated(-30)
        environment.billing.legal.dpaVersion = editionDated(-30)
        await ctx.prisma.workspace.updateMany({
            data: { createdAt: new Date(Date.now() - 60 * DAY) },
        })
        await accept(b.workspace.id, b.actor.auth).expect(201)
        expect((await checkout(a.workspace.id, a.actor).expect(403)).body.code).toBe(
            'LEGAL_ACCEPTANCE_REQUIRED',
        )
        await checkout(b.workspace.id, b.actor).expect(201)
    })
})
