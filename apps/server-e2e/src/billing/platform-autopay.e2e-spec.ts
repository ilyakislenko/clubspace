import { addMonths } from '../../../server/src/domains/billing/billing-rules'
import { BillingLifecycleService } from '../../../server/src/domains/billing/services/billing-lifecycle.service'
import { PlatformAutopayService } from '../../../server/src/domains/billing/services/platform-autopay.service'
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
const HOUR = 3_600_000
const DAY = 24 * HOUR

// Stands in for the platform's YooKassa shop at the PaymentGatewayClient
// boundary, like the club-payments spec: a redirect payment waits until the
// spec "pays" it, a saved-card charge answers at once (succeeded, or refused
// when the spec queued a decline). Everything else — guards, handlers, the
// webhook re-read, the renewal job, Postgres, the e-mail queue — is real.
class FakePlatformGateway {
    created: Array<{ creds: GatewayCredentials; input: CreateGatewayPaymentInput }> = []
    refunds: Array<{ providerPaymentId: string; amount: number; idempotenceKey: string }> = []
    declines: string[] = []
    private payments = new Map<string, GatewayPayment>()
    private seq = 0
    // YooKassa answers a repeated Idempotence-Key with the same payment.
    private byKey = new Map<string, string>()

    reset() {
        this.created = []
        this.refunds = []
        this.declines = []
        this.payments.clear()
        this.seq = 0
        this.byKey.clear()
    }

    // The payer completed YooKassa's page.
    pay(providerPaymentId: string) {
        const p = this.payments.get(providerPaymentId)
        if (!p) throw new Error(`unknown ${providerPaymentId}`)
        this.payments.set(providerPaymentId, { ...p, status: 'SUCCEEDED' })
    }

    createPayment = async (
        creds: GatewayCredentials,
        input: CreateGatewayPaymentInput,
    ): Promise<GatewayPayment> => {
        const known = this.byKey.get(input.idempotenceKey)
        if (known) return this.payments.get(known)!
        this.created.push({ creds, input })
        const id = `yk_platform_${++this.seq}`
        const decline = input.paymentMethodId ? this.declines.shift() : undefined
        const payment: GatewayPayment = {
            providerPaymentId: id,
            status: input.paymentMethodId ? (decline ? 'CANCELED' : 'SUCCEEDED') : 'PENDING',
            confirmationUrl: input.paymentMethodId ? null : `https://yookassa.test/confirm/${id}`,
            amountMinor: input.amount * 100,
            currency: input.currency,
            paymentMethod: {
                id: input.paymentMethodId ?? `pm_${this.seq}`,
                saved: input.paymentMethodId ? true : input.savePaymentMethod === true,
                title: 'Bank card *4444',
                cardLast4: '4444',
            },
            cancellationReason: decline ?? null,
        }
        this.payments.set(id, payment)
        this.byKey.set(input.idempotenceKey, id)
        return payment
    }

    getPayment = async (
        _creds: GatewayCredentials,
        providerPaymentId: string,
    ): Promise<GatewayPayment> => {
        const p = this.payments.get(providerPaymentId)
        if (!p) throw new Error(`unknown ${providerPaymentId}`)
        return p
    }

    refund = async (
        _creds: GatewayCredentials,
        p: { providerPaymentId: string; amount: number; idempotenceKey: string },
    ) => {
        this.refunds.push({
            providerPaymentId: p.providerPaymentId,
            amount: p.amount,
            idempotenceKey: p.idempotenceKey,
        })
    }

    checkConnection = async () => ({ accountId: '500500', testMode: true })
}

describe('platform autopay', () => {
    let ctx: TestApp
    const gateway = new FakePlatformGateway()
    let adminAuth: [string, string] | null = null

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

    const autopay = () => ctx.app.get(PlatformAutopayService)
    const lifecycle = () => ctx.app.get(BillingLifecycleService)
    const platformAdmin = async () => {
        adminAuth ??= (await signIn(ctx, PLATFORM_OWNER)).auth
        return adminAuth
    }

    type Club = {
        workspace: { id: string }
        owner: { id: string; email: string }
        actor: Actor
    }

    const club = async (name = 'Клуб «Автоплатёж»'): Promise<Club> => {
        const { workspace, owner } = await createWorkspace(ctx, { name })
        const actor = await signIn(ctx, owner.email)
        return { workspace, owner, actor }
    }

    // The club's billing row in a given state (the console path is covered
    // in platform-billing.e2e-spec.ts).
    const setBilling = (workspaceId: string, data: Record<string, unknown>) =>
        ctx.prisma.workspaceBilling.upsert({
            where: { workspaceId },
            create: { workspaceId, ...data },
            update: data,
        })

    const billingRow = (workspaceId: string) =>
        ctx.prisma.workspaceBilling.findUniqueOrThrow({ where: { workspaceId } })

    const webhook = (providerPaymentId: string) =>
        ctx
            .http()
            .post('/payments/webhooks/platform/yookassa')
            .send({ type: 'notification', event: 'payment.succeeded', object: { id: providerPaymentId } })

    // An active club whose paid period ends in `endsIn` ms, card saved.
    const activeWithCard = async (c: Club, endsIn: number) => {
        const currentPeriodEnd = new Date(Date.now() + endsIn)
        await setBilling(c.workspace.id, {
            status: 'ACTIVE',
            trialEndsAt: new Date(Date.now() - 40 * DAY),
            currentPeriodEnd,
            setupFeePaidAt: new Date(Date.now() - 40 * DAY),
            paymentMethodId: 'pm_saved',
            paymentMethodTitle: 'Bank card *1111',
            paymentMethodCardLast4: '1111',
            paymentMethodSavedAt: new Date(Date.now() - 40 * DAY),
        })
        return currentPeriodEnd
    }

    it('the first card payment extends the period, saves the card and clears past due', async () => {
        const c = await club()
        const trialEnd = new Date(Date.now() - 3 * DAY)
        await setBilling(c.workspace.id, {
            status: 'PAST_DUE',
            trialEndsAt: trialEnd,
            pastDueSince: trialEnd,
        })

        const page = await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/billing`)
            .set(...c.actor.auth)
            .expect(200)
        expect(page.body.billing.autopay).toMatchObject({ available: true, card: null })
        const annualTotal = page.body.billing.checkout.annual.total
        expect(page.body.billing.checkout.monthly.total).toBe(2990 + 4990)

        const res = await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/billing/checkout`)
            .set(...c.actor.auth)
            .send({ periodMonths: 12 })
            .expect(201)
        expect(res.body.confirmationUrl).toMatch(/^https:\/\/yookassa\.test\/confirm\//)
        expect(res.body.payment).toMatchObject({
            status: 'PENDING',
            kind: 'PERIOD',
            initiator: 'OWNER',
            amount: annualTotal,
            periodMonths: 12,
            receiptEmail: c.owner.email,
        })
        expect(gateway.created).toHaveLength(1)
        const sent = gateway.created[0]
        expect(sent.creds).toMatchObject({ provider: 'YOOKASSA', shopId: '500500' })
        expect(sent.input).toMatchObject({
            amount: annualTotal,
            customerEmail: c.owner.email,
            savePaymentMethod: true,
            returnUrl: expect.stringContaining(
                `/workspace/${c.workspace.id}/billing?payment=${res.body.payment.id}`,
            ),
        })
        expect(sent.input.paymentMethodId).toBeUndefined()

        // A second tap reuses the same page.
        const again = await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/billing/checkout`)
            .set(...c.actor.auth)
            .send({ periodMonths: 12 })
            .expect(201)
        expect(again.body.payment.id).toBe(res.body.payment.id)
        expect(gateway.created).toHaveLength(1)

        const { providerPaymentId: pid } =
            await ctx.prisma.platformPayment.findUniqueOrThrow({
                where: { id: res.body.payment.id },
            })
        const providerPaymentId = pid!
        gateway.pay(providerPaymentId)
        const before = Date.now()
        await webhook(providerPaymentId).expect(200)
        // A repeated notification changes nothing.
        await webhook(providerPaymentId).expect(200)

        const row = await billingRow(c.workspace.id)
        expect(row.status).toBe('ACTIVE')
        expect(row.pastDueSince).toBeNull()
        expect(row.setupFeePaidAt).not.toBeNull()
        expect(row.billingPeriodMonths).toBe(12)
        expect(row.paymentMethodId).toBe('pm_1')
        expect(row.paymentMethodCardLast4).toBe('4444')
        const expectedEnd = addMonths(new Date(before), 12).getTime()
        expect(Math.abs(row.currentPeriodEnd!.getTime() - expectedEnd)).toBeLessThan(60_000)

        const payments = await ctx.prisma.platformPayment.findMany({
            where: { workspaceId: c.workspace.id },
        })
        expect(payments).toHaveLength(1)
        expect(payments[0]).toMatchObject({ status: 'SUCCEEDED', cardLast4: '4444' })

        // The owner back on the page: the history and the saved card.
        const back = await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/billing/payments/${res.body.payment.id}`)
            .set(...c.actor.auth)
            .expect(200)
        expect(back.body.status).toBe('SUCCEEDED')
        const history = await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/billing/payments`)
            .set(...c.actor.auth)
            .expect(200)
        expect(history.body.data).toHaveLength(1)
        expect(history.body.data[0].lines.map((l: { code: string }) => l.code)).toEqual([
            'tier',
            'setup',
        ])
        const after = await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/billing`)
            .set(...c.actor.auth)
            .expect(200)
        expect(after.body.billing.autopay.card).toMatchObject({ last4: '4444' })

        // Removing the card turns autopay off for this club.
        const removed = await ctx
            .http()
            .delete(`/workspaces/${c.workspace.id}/billing/payment-method`)
            .set(...c.actor.auth)
            .expect(200)
        expect(removed.body.card).toBeNull()
        expect((await billingRow(c.workspace.id)).paymentMethodId).toBeNull()
    })

    it('a renewal charges the saved card once, even when the job runs twice', async () => {
        const c = await club()
        const end = await activeWithCard(c, 12 * HOUR)
        const now = new Date()

        // Not due yet two days before the end.
        expect(await autopay().runRenewals(new Date(end.getTime() - 2 * DAY))).toEqual({})
        expect(gateway.created).toHaveLength(0)

        // Two replicas at once, then a late rerun.
        await Promise.all([autopay().runRenewals(now), autopay().runRenewals(now)])
        await autopay().runRenewals(now)

        expect(gateway.created).toHaveLength(1)
        expect(gateway.created[0].input).toMatchObject({
            paymentMethodId: 'pm_saved',
            amount: 2990,
            idempotenceKey: `renewal:${c.workspace.id}:${end.toISOString()}:0`,
        })
        const row = await billingRow(c.workspace.id)
        expect(row.status).toBe('ACTIVE')
        expect(row.currentPeriodEnd!.toISOString()).toBe(addMonths(end, 1).toISOString())
        const payments = await ctx.prisma.platformPayment.findMany({
            where: { workspaceId: c.workspace.id },
        })
        expect(payments).toHaveLength(1)
        expect(payments[0]).toMatchObject({
            status: 'SUCCEEDED',
            initiator: 'AUTOPAY',
            amount: 2990,
            periodStart: end,
        })
    })

    it('a refused renewal tells the owner each time, retries, and the club is suspended after grace', async () => {
        const c = await club('Клуб с пустой картой')
        const end = await activeWithCard(c, 12 * HOUR)
        gateway.declines.push('insufficient_funds', 'insufficient_funds')
        const now = new Date()

        expect(await autopay().runRenewals(now)).toEqual({ FAILED: 1 })
        let row = await billingRow(c.workspace.id)
        expect(row.status).toBe('ACTIVE')
        expect(row.autopayFailedAttempts).toBe(1)
        expect(row.autopayNextAttemptAt!.getTime()).toBe(now.getTime() + DAY)
        expect(row.autopayLastError).toBe('на карте недостаточно средств')
        const mail = await ctx.mail.waitFor(
            (m) => m.to === c.owner.email && m.subject.includes('Не удалось списать оплату'),
        )
        expect(mail.html).toContain('недостаточно средств')
        const pushes = await ctx.prisma.notification.findMany({
            where: { userId: c.owner.id, type: 'PUSH' },
        })
        expect(pushes).toHaveLength(1)
        expect(pushes[0].metadata).toMatchObject({ kind: 'platformBilling.chargeFailed' })

        // Before the retry is due nothing is charged.
        await autopay().runRenewals(new Date(now.getTime() + 2 * HOUR))
        expect(gateway.created).toHaveLength(1)

        // The period ends unpaid: past due.
        await lifecycle().run(new Date(end.getTime() + 60_000))
        expect((await billingRow(c.workspace.id)).status).toBe('PAST_DUE')

        // The retry a day later is refused again: a second e-mail and push.
        ctx.mail.clear()
        expect(await autopay().runRenewals(new Date(now.getTime() + DAY + HOUR))).toEqual({
            FAILED: 1,
        })
        expect(gateway.created).toHaveLength(2)
        expect(gateway.created[1].input.idempotenceKey).toBe(
            `renewal:${c.workspace.id}:${end.toISOString()}:1`,
        )
        row = await billingRow(c.workspace.id)
        expect(row.autopayFailedAttempts).toBe(2)
        await ctx.mail.waitFor(
            (m) => m.to === c.owner.email && m.subject.includes('Не удалось списать оплату'),
        )
        expect(
            await ctx.prisma.notification.count({ where: { userId: c.owner.id, type: 'PUSH' } }),
        ).toBe(2)

        // Grace runs out: the existing lifecycle suspends the club, and
        // autopay leaves a suspended club alone.
        const afterGrace = new Date(end.getTime() + (environment.billing.graceDays + 1) * DAY)
        await lifecycle().run(afterGrace)
        expect((await billingRow(c.workspace.id)).status).toBe('SUSPENDED')
        await autopay().runRenewals(afterGrace)
        expect(gateway.created).toHaveLength(2)
    })

    it('a free period (comp) is extended without a charge', async () => {
        const c = await club()
        const end = await activeWithCard(c, 12 * HOUR)
        await ctx
            .http()
            .post(`/platform/workspaces/${c.workspace.id}/billing`)
            .set(...(await platformAdmin()))
            .send({ kind: 'setCustomPrice', customMonthlyPrice: 0 })
            .expect(201)

        expect(await autopay().runRenewals(new Date())).toEqual({ EXTENDED_FREE: 1 })
        await autopay().runRenewals(new Date())

        expect(gateway.created).toHaveLength(0)
        const row = await billingRow(c.workspace.id)
        expect(row.currentPeriodEnd!.toISOString()).toBe(addMonths(end, 1).toISOString())
        const payments = await ctx.prisma.platformPayment.findMany({
            where: { workspaceId: c.workspace.id },
        })
        expect(payments).toHaveLength(1)
        expect(payments[0]).toMatchObject({ amount: 0, status: 'SUCCEEDED', provider: null })
    })

    it('connecting a module mid-period charges the rest of the period; the platform wins', async () => {
        const c = await club()
        const end = await activeWithCard(c, 15 * DAY)

        // Saved card: charged at once for the part of the month left.
        const video = await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/billing/modules`)
            .set(...c.actor.auth)
            .send({ module: 'VIDEO', enabled: true })
            .expect(201)
        expect(video.body.outcome).toBe('CONNECTED')
        expect(gateway.created).toHaveLength(1)
        const charged = gateway.created[0].input
        expect(charged.paymentMethodId).toBe('pm_saved')
        const periodMs = end.getTime() - addMonths(end, -1).getTime()
        const expected = Math.round((990 * (end.getTime() - Date.now())) / periodMs)
        expect(Math.abs(charged.amount - expected)).toBeLessThanOrEqual(1)
        expect(charged.amount).toBeLessThan(990)
        expect(video.body.payment).toMatchObject({
            kind: 'MODULE',
            module: 'VIDEO',
            status: 'SUCCEEDED',
            amount: charged.amount,
        })
        const page = await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/billing`)
            .set(...c.actor.auth)
            .expect(200)
        const videoState = page.body.billing.modules.find((m: { code: string }) => m.code === 'VIDEO')
        expect(videoState).toMatchObject({ source: 'PAID', entitled: true, cancelAt: null })
        // On the next bill at the full price.
        expect(page.body.billing.quote.lines.map((l: { code: string }) => l.code)).toContain(
            'module:VIDEO',
        )

        // Disconnecting keeps it until the paid period ends.
        const off = await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/billing/modules`)
            .set(...c.actor.auth)
            .send({ module: 'VIDEO', enabled: false })
            .expect(201)
        expect(off.body.outcome).toBe('DISCONNECT_SCHEDULED')
        const ent = await ctx.prisma.workspaceModuleEntitlement.findFirstOrThrow({
            where: { workspaceId: c.workspace.id, module: 'VIDEO' },
        })
        expect(ent.cancelAt!.toISOString()).toBe(end.toISOString())

        // Without a saved card: YooKassa's page, the module on after payment.
        await setBilling(c.workspace.id, { paymentMethodId: null })
        const payments = await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/billing/modules`)
            .set(...c.actor.auth)
            .send({ module: 'ONLINE_PAYMENTS', enabled: true })
            .expect(201)
        expect(payments.body.outcome).toBe('PAYMENT_REQUIRED')
        expect(payments.body.confirmationUrl).toMatch(/^https:\/\/yookassa\.test\//)
        const pending = await ctx.prisma.platformPayment.findUniqueOrThrow({
            where: { id: payments.body.payment.id },
        })
        expect(
            await ctx.prisma.workspaceModuleEntitlement.findFirst({
                where: { workspaceId: c.workspace.id, module: 'ONLINE_PAYMENTS' },
            }),
        ).toBeNull()
        gateway.pay(pending.providerPaymentId!)
        await webhook(pending.providerPaymentId!).expect(200)
        expect(
            await ctx.prisma.workspaceModuleEntitlement.findFirstOrThrow({
                where: { workspaceId: c.workspace.id, module: 'ONLINE_PAYMENTS' },
            }),
        ).toMatchObject({ mode: 'PAID', cancelAt: null })

        // A module the platform switched off cannot be connected by the club.
        await ctx
            .http()
            .post(`/platform/workspaces/${c.workspace.id}/modules`)
            .set(...(await platformAdmin()))
            .send({ module: 'BRANDED_APP', mode: 'OFF' })
            .expect(201)
        const refused = await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/billing/modules`)
            .set(...c.actor.auth)
            .send({ module: 'BRANDED_APP', enabled: true })
            .expect(400)
        expect(refused.body.message).toContain('отключён командой ClubSpace')
    })

    it("another club's admin cannot see, pay or refund; only the super admin refunds", async () => {
        const a = await club('Клуб А')
        const b = await club('Клуб Б')
        await activeWithCard(a, 12 * HOUR)
        await autopay().runRenewals(new Date())
        const payment = await ctx.prisma.platformPayment.findFirstOrThrow({
            where: { workspaceId: a.workspace.id },
        })
        const { user: coachUser } = await addMember(ctx, {
            workspaceId: a.workspace.id,
            role: RolesEnum.COACH,
        })
        const coach = await signIn(ctx, coachUser.email)

        // Club B's owner against club A's routes.
        await ctx
            .http()
            .get(`/workspaces/${a.workspace.id}/billing/payments`)
            .set(...b.actor.auth)
            .expect(403)
        await ctx
            .http()
            .get(`/workspaces/${a.workspace.id}/billing/payments/${payment.id}`)
            .set(...b.actor.auth)
            .expect(403)
        await ctx
            .http()
            .post(`/workspaces/${a.workspace.id}/billing/checkout`)
            .set(...b.actor.auth)
            .send({ periodMonths: 1 })
            .expect(403)
        await ctx
            .http()
            .post(`/workspaces/${a.workspace.id}/billing/modules`)
            .set(...b.actor.auth)
            .send({ module: 'VIDEO', enabled: true })
            .expect(403)
        await ctx
            .http()
            .delete(`/workspaces/${a.workspace.id}/billing/payment-method`)
            .set(...b.actor.auth)
            .expect(403)
        // …nor through its own club's path.
        await ctx
            .http()
            .get(`/workspaces/${b.workspace.id}/billing/payments/${payment.id}`)
            .set(...b.actor.auth)
            .expect(404)
        // A coach of club A is not a club admin.
        await ctx
            .http()
            .post(`/workspaces/${a.workspace.id}/billing/checkout`)
            .set(...coach.auth)
            .send({ periodMonths: 1 })
            .expect(403)
        await ctx
            .http()
            .get(`/workspaces/${a.workspace.id}/billing/payments`)
            .set(...coach.auth)
            .expect(403)

        // Refunds and the console list are the super admin's alone.
        for (const actor of [a.actor, b.actor]) {
            await ctx
                .http()
                .post(`/platform/workspaces/${a.workspace.id}/payments/${payment.id}/refund`)
                .set(...actor.auth)
                .send({})
                .expect(403)
            await ctx
                .http()
                .get(`/platform/workspaces/${a.workspace.id}/payments`)
                .set(...actor.auth)
                .expect(403)
            await ctx
                .http()
                .post(`/platform/workspaces/${a.workspace.id}/payments/retry`)
                .set(...actor.auth)
                .expect(403)
            await ctx
                .http()
                .post(`/platform/workspaces/${a.workspace.id}/autopay`)
                .set(...actor.auth)
                .send({ enabled: false })
                .expect(403)
        }
        expect(gateway.refunds).toHaveLength(0)

        const admin = await platformAdmin()
        // Under another club's path the payment does not exist.
        await ctx
            .http()
            .post(`/platform/workspaces/${b.workspace.id}/payments/${payment.id}/refund`)
            .set(...admin)
            .send({})
            .expect(404)
        const partial = await ctx
            .http()
            .post(`/platform/workspaces/${a.workspace.id}/payments/${payment.id}/refund`)
            .set(...admin)
            .send({ amount: 1000, reason: 'Компенсация простоя' })
            .expect(201)
        expect(partial.body).toMatchObject({ status: 'SUCCEEDED', refundedAmount: 1000 })
        const rest = await ctx
            .http()
            .post(`/platform/workspaces/${a.workspace.id}/payments/${payment.id}/refund`)
            .set(...admin)
            .send({})
            .expect(201)
        expect(rest.body).toMatchObject({ status: 'REFUNDED', refundedAmount: payment.amount })
        expect(gateway.refunds.map((r) => r.amount)).toEqual([1000, payment.amount - 1000])
        await ctx
            .http()
            .post(`/platform/workspaces/${a.workspace.id}/payments/${payment.id}/refund`)
            .set(...admin)
            .send({})
            .expect(400)
        const audit = await ctx.prisma.auditEvent.findMany({
            where: { workspaceId: a.workspace.id, action: 'workspace.billingRefund' },
        })
        expect(audit).toHaveLength(2)

        // The console list and the autopay switch.
        const list = await ctx
            .http()
            .get(`/platform/workspaces/${a.workspace.id}/payments`)
            .set(...admin)
            .expect(200)
        expect(list.body.data).toHaveLength(1)
        const toggled = await ctx
            .http()
            .post(`/platform/workspaces/${a.workspace.id}/autopay`)
            .set(...admin)
            .send({ enabled: false })
            .expect(201)
        expect(toggled.body.billing.autopay.enabled).toBe(false)
    })

    it('ignores notifications for payments that are not ours', async () => {
        await webhook('yk_somebody_else').expect(200)
        await ctx
            .http()
            .post('/payments/webhooks/platform/yookassa')
            .send({ nonsense: true })
            .expect(400)
    })
})
