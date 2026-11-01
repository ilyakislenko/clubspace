import type {
    CreateGatewayPaymentInput,
    GatewayCredentials,
    GatewayPayment,
    GatewayPaymentStatus,
} from '../../../server/src/domains/payments/payment-gateway.types'
import { signStripePayload } from '../../../server/src/domains/payments/stripe-signature'
import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { type Actor, signIn } from '../support/actors'
import { addMember, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// Stands in for YooKassa / Stripe at the PaymentGatewayClient boundary: keeps
// the payments it "created", answers re-reads with whatever status the spec
// sets, and records every call. Everything else — guards, handlers, the
// webhook signature check, the subscription grant, Postgres — is real.
class FakeGateway {
    created: Array<{ creds: GatewayCredentials; input: CreateGatewayPaymentInput }> = []
    refunds: Array<{ providerPaymentId: string; idempotenceKey: string }> = []
    reads = 0
    private payments = new Map<string, GatewayPayment>()
    private seq = 0

    reset() {
        this.created = []
        this.refunds = []
        this.reads = 0
        this.payments.clear()
        this.seq = 0
    }

    setStatus(providerPaymentId: string, status: GatewayPaymentStatus) {
        const p = this.payments.get(providerPaymentId)
        if (!p) throw new Error(`unknown ${providerPaymentId}`)
        this.payments.set(providerPaymentId, { ...p, status })
    }

    createPayment = async (
        creds: GatewayCredentials,
        input: CreateGatewayPaymentInput,
    ): Promise<GatewayPayment> => {
        this.created.push({ creds, input })
        const id = `${creds.provider === 'STRIPE' ? 'cs' : 'yk'}_${++this.seq}`
        const payment: GatewayPayment = {
            providerPaymentId: id,
            status: 'PENDING',
            confirmationUrl: `https://provider.test/confirm/${id}`,
            amountMinor: input.amount * 100,
            currency: input.currency,
        }
        this.payments.set(id, payment)
        return payment
    }

    getPayment = async (
        _creds: GatewayCredentials,
        providerPaymentId: string,
    ): Promise<GatewayPayment> => {
        this.reads++
        const p = this.payments.get(providerPaymentId)
        if (!p) throw new Error(`unknown ${providerPaymentId}`)
        return p
    }

    refund = async (
        _creds: GatewayCredentials,
        p: { providerPaymentId: string; idempotenceKey: string },
    ) => {
        this.refunds.push({
            providerPaymentId: p.providerPaymentId,
            idempotenceKey: p.idempotenceKey,
        })
    }

    checkConnection = async () => ({ accountId: '123456', testMode: true })
}

type Setup = {
    workspace: { id: string }
    ownerActor: Actor
    memberActor: Actor
    plan: { id: string }
}

describe('online payment of an abonement', () => {
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

    const setup = async (memberAccessUntil: Date | null = null) => {
        const { workspace, owner } = await createWorkspace(ctx)
        const { user: memberUser } = await addMember(ctx, {
            workspaceId: workspace.id,
            accessUntil: memberAccessUntil,
        })
        const { user: coachUser } = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.COACH,
        })
        const plan = await createPlan(ctx, {
            workspaceId: workspace.id,
            name: 'Безлимит',
            price: 4500,
            classCount: null,
            durationDays: 30,
        })
        const ownerActor = await signIn(ctx, owner.email)
        const memberActor = await signIn(ctx, memberUser.email)
        return { workspace, owner, ownerActor, memberUser, memberActor, coachUser, plan }
    }


    const connect = (s: Setup, body: Record<string, unknown>) =>
        ctx
            .http()
            .put(`/workspaces/${s.workspace.id}/payment-settings`)
            .set(...s.ownerActor.auth)
            .send(body)

    const sellOnline = (s: Setup) =>
        ctx
            .http()
            .patch(`/workspaces/${s.workspace.id}/plans/${s.plan.id}`)
            .set(...s.ownerActor.auth)
            .send({ purchasableOnline: true })

    const buy = (s: Setup) =>
        ctx
            .http()
            .post(`/workspaces/${s.workspace.id}/payments`)
            .set(...s.memberActor.auth)
            .send({ planId: s.plan.id })

    const yookassaWebhook = (workspaceId: string, body: unknown) =>
        ctx.http().post(`/payments/webhooks/yookassa/${workspaceId}`).send(body)

    const stripeWebhook = (
        workspaceId: string,
        raw: string,
        secret = 'whsec_e2e_signing',
        t = Math.floor(Date.now() / 1000),
    ) =>
        ctx
            .http()
            .post(`/payments/webhooks/stripe/${workspaceId}`)
            .set('Content-Type', 'application/json')
            .set('Stripe-Signature', `t=${t},v1=${signStripePayload(raw, secret, t)}`)
            .send(raw)

    const gatewaySubs = (workspaceId: string) =>
        ctx.prisma.subscription.findMany({
            where: { workspaceId, source: 'GATEWAY' },
        })

    it('keeps the keys admin-only and encrypted at rest', async () => {
        const s = await setup()
        const coach = await signIn(ctx, s.coachUser.email)
        const asCoach = await ctx
            .http()
            .put(`/workspaces/${s.workspace.id}/payment-settings`)
            .set(...coach.auth)
            .send({ provider: 'YOOKASSA', shopId: '123456', secretKey: 'live_secret_0001' })
        expect(asCoach.status).toBe(403)
        const asMember = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/payment-settings`)
            .set(...s.memberActor.auth)
        expect(asMember.status).toBe(403)

        const saved = await connect(s, {
            provider: 'YOOKASSA',
            shopId: '123456',
            secretKey: 'live_secret_0001',
            vatCode: 11,
        })
        expect(saved.status).toBe(200)
        expect(saved.body).toMatchObject({
            connected: true,
            provider: 'YOOKASSA',
            shopId: '123456',
            secretKeyMasked: '••••0001',
            vatCode: 11,
        })
        expect(JSON.stringify(saved.body)).not.toContain('live_secret')

        const row = await ctx.prisma.workspacePaymentSettings.findUniqueOrThrow({
            where: { workspaceId: s.workspace.id },
        })
        expect(row.secretKeyEncrypted).not.toContain('live_secret')

        const check = await ctx
            .http()
            .post(`/workspaces/${s.workspace.id}/payment-settings/check`)
            .set(...s.ownerActor.auth)
        expect(check.status).toBe(201)
        expect(check.body).toMatchObject({ ok: true, testMode: true, accountId: '123456' })
    })

    it('YooKassa: pay → webhook re-read → abonement, once; refund leaves the abonement', async () => {
        const s = await setup()
        await connect(s, { provider: 'YOOKASSA', shopId: '123456', secretKey: 'live_secret_0001' })

        const before = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/me/online-purchase`)
            .set(...s.memberActor.auth)
        expect(before.body.available).toBe(false)

        expect((await sellOnline(s)).body.purchasableOnline).toBe(true)
        const options = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/me/online-purchase`)
            .set(...s.memberActor.auth)
        expect(options.status).toBe(200)
        expect(options.body).toMatchObject({
            available: true,
            provider: 'YOOKASSA',
            plans: [{ id: s.plan.id, price: 4500, directions: [] }],
            blockedReason: null,
        })

        const created = await buy(s)
        expect(created.status).toBe(201)
        expect(created.body.confirmationUrl).toBe('https://provider.test/confirm/yk_1')
        const paymentId = created.body.payment.id
        expect(gateway.created).toHaveLength(1)
        expect(gateway.created[0].creds).toMatchObject({
            provider: 'YOOKASSA',
            shopId: '123456',
            secretKey: 'live_secret_0001',
        })
        expect(gateway.created[0].input).toMatchObject({
            paymentId,
            amount: 4500,
            currency: 'RUB',
            customerEmail: s.memberUser.email,
            returnUrl: expect.stringMatching(new RegExp(`/payment/${paymentId}$`)),
        })

        // A double tap reuses the pending payment.
        const again = await buy(s)
        expect(again.body.payment.id).toBe(paymentId)
        expect(gateway.created).toHaveLength(1)

        // A forged "succeeded" notification while YooKassa still says pending.
        const forged = await yookassaWebhook(s.workspace.id, {
            type: 'notification',
            event: 'payment.succeeded',
            object: { id: 'yk_1', status: 'succeeded', paid: true },
        })
        expect(forged.status).toBe(200)
        expect(await gatewaySubs(s.workspace.id)).toHaveLength(0)
        const pending = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/me/payments/${paymentId}`)
            .set(...s.memberActor.auth)
        expect(pending.body.status).toBe('PENDING')

        gateway.setStatus('yk_1', 'SUCCEEDED')
        const notification = {
            type: 'notification',
            event: 'payment.succeeded',
            object: { id: 'yk_1' },
        }
        expect((await yookassaWebhook(s.workspace.id, notification)).status).toBe(200)
        // Retried and concurrent deliveries change nothing.
        const dupes = await Promise.all([
            yookassaWebhook(s.workspace.id, notification),
            yookassaWebhook(s.workspace.id, notification),
            yookassaWebhook(s.workspace.id, notification),
        ])
        expect(dupes.map((r) => r.status)).toEqual([200, 200, 200])

        const subs = await gatewaySubs(s.workspace.id)
        expect(subs).toHaveLength(1)
        expect(subs[0]).toMatchObject({
            planId: s.plan.id,
            isPaid: true,
            amountPaid: 4500,
            provider: 'yookassa',
            externalPaymentId: 'yk_1',
            status: 'ACTIVE',
        })
        expect(subs[0].paidAt).not.toBeNull()

        const paid = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/me/payments/${paymentId}`)
            .set(...s.memberActor.auth)
        expect(paid.body).toMatchObject({
            status: 'SUCCEEDED',
            subscriptionId: subs[0].id,
            activationError: null,
        })
        const mine = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/me/subscription`)
            .set(...s.memberActor.auth)
        expect(mine.body.abonements).toEqual([
            expect.objectContaining({ id: subs[0].id, source: 'GATEWAY', directions: [] }),
        ])

        const notices = await ctx.prisma.notification.findMany({
            where: { userId: s.memberUser.id },
        })
        expect(
            notices.filter(
                (n) => (n.metadata as { kind?: string } | null)?.kind === 'payment.succeeded',
            ),
        ).toHaveLength(1)
        expect(
            await ctx.prisma.auditEvent.count({
                where: { workspaceId: s.workspace.id, action: 'payment.succeeded' },
            }),
        ).toBe(1)

        // Someone else's payment is not readable.
        const coach = await signIn(ctx, s.coachUser.email)
        const foreign = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/me/payments/${paymentId}`)
            .set(...coach.auth)
        expect(foreign.status).toBe(404)

        const list = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/payments`)
            .set(...s.ownerActor.auth)
        expect(list.status).toBe(200)
        expect(list.body.data).toHaveLength(1)
        expect(list.body.data[0]).toMatchObject({
            id: paymentId,
            status: 'SUCCEEDED',
            member: { userId: s.memberUser.id },
        })
        const coachList = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/payments`)
            .set(...coach.auth)
        expect(coachList.status).toBe(403)

        const refunded = await ctx
            .http()
            .post(`/workspaces/${s.workspace.id}/payments/${paymentId}/refund`)
            .set(...s.ownerActor.auth)
        expect(refunded.status).toBe(201)
        expect(refunded.body.status).toBe('REFUNDED')
        expect(gateway.refunds).toEqual([
            { providerPaymentId: 'yk_1', idempotenceKey: `refund-${paymentId}` },
        ])
        const twice = await ctx
            .http()
            .post(`/workspaces/${s.workspace.id}/payments/${paymentId}/refund`)
            .set(...s.ownerActor.auth)
        expect(twice.status).toBe(400)
        // Staff decide about the abonement.
        const still = await ctx.prisma.subscription.findUniqueOrThrow({
            where: { id: subs[0].id },
        })
        expect(still.status).toBe('ACTIVE')
    })

    it('YooKassa: a canceled payment creates nothing', async () => {
        const s = await setup()
        await connect(s, { provider: 'YOOKASSA', shopId: '123456', secretKey: 'live_secret_0001' })
        await sellOnline(s)
        const created = await buy(s)
        gateway.setStatus('yk_1', 'CANCELED')
        await yookassaWebhook(s.workspace.id, { object: { id: 'yk_1' } }).expect(200)
        const payment = await ctx.prisma.payment.findUniqueOrThrow({
            where: { id: created.body.payment.id },
        })
        expect(payment.status).toBe('CANCELED')
        expect(await gatewaySubs(s.workspace.id)).toHaveLength(0)
    })

    it('Stripe: signed webhook activates once; bad signature → 401; replay is a no-op', async () => {
        const s = await setup()
        const saved = await connect(s, {
            provider: 'STRIPE',
            secretKey: 'sk_test_e2e_0001',
            webhookSecret: 'whsec_e2e_signing',
        })
        expect(saved.body).toMatchObject({ provider: 'STRIPE', webhookSecretSet: true })
        await sellOnline(s)
        const created = await buy(s)
        expect(created.status).toBe(201)
        expect(created.body.confirmationUrl).toBe('https://provider.test/confirm/cs_1')

        const event = JSON.stringify({
            id: 'evt_1',
            type: 'checkout.session.completed',
            data: {
                object: {
                    id: 'cs_1',
                    status: 'complete',
                    payment_status: 'paid',
                    amount_total: 450000,
                    currency: 'rub',
                    payment_intent: 'pi_1',
                    metadata: { paymentId: created.body.payment.id },
                },
            },
        })

        const forged = await stripeWebhook(s.workspace.id, event, 'whsec_attacker')
        expect(forged.status).toBe(401)
        const stale = await stripeWebhook(
            s.workspace.id,
            event,
            'whsec_e2e_signing',
            Math.floor(Date.now() / 1000) - 3600,
        )
        expect(stale.status).toBe(401)
        expect(await gatewaySubs(s.workspace.id)).toHaveLength(0)

        const ok = await stripeWebhook(s.workspace.id, event)
        expect(ok.status).toBe(200)
        expect(ok.body).toEqual({ received: true })
        const replays = await Promise.all([
            stripeWebhook(s.workspace.id, event),
            stripeWebhook(s.workspace.id, event),
        ])
        expect(replays.map((r) => r.status)).toEqual([200, 200])

        const subs = await gatewaySubs(s.workspace.id)
        expect(subs).toHaveLength(1)
        expect(subs[0]).toMatchObject({ provider: 'stripe', externalPaymentId: 'cs_1' })
        // Stripe is never re-read: the signature is the proof.
        expect(gateway.reads).toBe(0)
    })

    it('a member whose access ran out can still buy (the lock screen offer)', async () => {
        const s = await setup(new Date(Date.now() - 24 * 60 * 60 * 1000))
        await connect(s, { provider: 'YOOKASSA', shopId: '123456', secretKey: 'live_secret_0001' })
        await sellOnline(s)

        // Regular member routes stay closed to them…
        const locked = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/me/subscription`)
            .set(...s.memberActor.auth)
        expect(locked.status).toBe(403)

        // …but paying is how access comes back.
        const options = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/me/online-purchase`)
            .set(...s.memberActor.auth)
        expect(options.body.available).toBe(true)
        const created = await buy(s)
        expect(created.status).toBe(201)

        gateway.setStatus('yk_1', 'SUCCEEDED')
        await yookassaWebhook(s.workspace.id, { object: { id: 'yk_1' } }).expect(200)
        const member = await ctx.prisma.workspaceMember.findFirstOrThrow({
            where: { workspaceId: s.workspace.id, userId: s.memberUser.id },
        })
        expect(member.accessUntil!.getTime()).toBeGreaterThan(Date.now())
    })

    it('a webhook for another club cannot touch this club’s payment', async () => {
        const s = await setup()
        await connect(s, { provider: 'YOOKASSA', shopId: '123456', secretKey: 'live_secret_0001' })
        await sellOnline(s)
        await buy(s)
        gateway.setStatus('yk_1', 'SUCCEEDED')

        const other = await createWorkspace(ctx)
        await ctx.prisma.workspacePaymentSettings.create({
            data: {
                workspaceId: other.workspace.id,
                provider: 'YOOKASSA',
                shopId: '999',
                secretKeyEncrypted: (
                    await ctx.prisma.workspacePaymentSettings.findUniqueOrThrow({
                        where: { workspaceId: s.workspace.id },
                    })
                ).secretKeyEncrypted,
                secretKeyHint: '0001',
            },
        })
        await yookassaWebhook(other.workspace.id, { object: { id: 'yk_1' } }).expect(200)
        expect(gateway.reads).toBe(0)
        expect(await gatewaySubs(s.workspace.id)).toHaveLength(0)

        const unconfigured = await createWorkspace(ctx)
        await yookassaWebhook(unconfigured.workspace.id, { object: { id: 'yk_1' } }).expect(404)
    })
})
