import { VIDEO_UNAVAILABLE_FOR_MEMBERS } from '../../../server/src/domains/billing/module-entitlement'
import { BillingLifecycleService } from '../../../server/src/domains/billing/services/billing-lifecycle.service'
import { PlatformAutopayService } from '../../../server/src/domains/billing/services/platform-autopay.service'
import {
    TRIAL_REMINDER_KIND,
    TrialRemindersService,
} from '../../../server/src/domains/billing/services/trial-reminders.service'
import type {
    CreateGatewayPaymentInput,
    GatewayCredentials,
    GatewayPayment,
} from '../../../server/src/domains/payments/payment-gateway.types'
import { type Actor, signIn } from '../support/actors'
import { addMember, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

const PLATFORM_OWNER = 'platform-owner@clubspace.test'
const HOUR = 3_600_000
const DAY = 24 * HOUR
const GB = 1024 ** 3

// The codes of a payment's frozen quote (PlatformPayment.lines JSON).
const lineCodes = (json: unknown): string[] =>
    json && typeof json === 'object' && 'lines' in json && Array.isArray(json.lines)
        ? json.lines.map((l: { code: string }) => l.code)
        : []

// The platform's YooKassa shop at the PaymentGatewayClient boundary, as in
// platform-autopay.e2e-spec.ts: a redirect payment waits until the spec pays
// it, a saved-card charge succeeds at once. Everything else is real.
class FakePlatformGateway {
    created: Array<{ creds: GatewayCredentials; input: CreateGatewayPaymentInput }> = []
    refunds: Array<{ providerPaymentId: string; amount: number; idempotenceKey: string }> = []
    private payments = new Map<string, GatewayPayment>()
    private byKey = new Map<string, string>()
    private seq = 0

    reset() {
        this.created = []
        this.refunds = []
        this.payments.clear()
        this.byKey.clear()
        this.seq = 0
    }

    pay(providerPaymentId: string) {
        const p = this.payments.get(providerPaymentId)!
        this.payments.set(providerPaymentId, { ...p, status: 'SUCCEEDED' })
    }

    // Saved-card charges (no payer on a page): what autopay sent.
    get savedCardCharges() {
        return this.created.filter((c) => c.input.paymentMethodId)
    }

    createPayment = async (
        creds: GatewayCredentials,
        input: CreateGatewayPaymentInput,
    ): Promise<GatewayPayment> => {
        const known = this.byKey.get(input.idempotenceKey)
        if (known) return this.payments.get(known)!
        this.created.push({ creds, input })
        const id = `yk_trial_${++this.seq}`
        const payment: GatewayPayment = {
            providerPaymentId: id,
            status: input.paymentMethodId ? 'SUCCEEDED' : 'PENDING',
            confirmationUrl: input.paymentMethodId ? null : `https://yookassa.test/confirm/${id}`,
            amountMinor: input.amount * 100,
            currency: input.currency,
            paymentMethod: {
                id: input.paymentMethodId ?? `pm_${this.seq}`,
                saved: input.paymentMethodId ? true : input.savePaymentMethod === true,
                title: 'Bank card *4444',
                cardLast4: '4444',
            },
            cancellationReason: null,
        }
        this.payments.set(id, payment)
        this.byKey.set(input.idempotenceKey, id)
        return payment
    }

    getPayment = async (_creds: GatewayCredentials, providerPaymentId: string) =>
        this.payments.get(providerPaymentId)!

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

describe('trial guards', () => {
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

    const platformAdmin = async () => {
        adminAuth ??= (await signIn(ctx, PLATFORM_OWNER)).auth
        return adminAuth
    }

    type Club = { workspace: { id: string; key: string }; owner: { id: string; email: string }; actor: Actor }
    const club = async (name = 'Клуб на пробном'): Promise<Club> => {
        const { workspace, owner } = await createWorkspace(ctx, { name })
        const actor = await signIn(ctx, owner.email)
        return { workspace, owner, actor }
    }

    const setBilling = (workspaceId: string, data: Record<string, unknown>) =>
        ctx.prisma.workspaceBilling.upsert({
            where: { workspaceId },
            create: { workspaceId, ...data },
            update: data,
        })
    const billingRow = (workspaceId: string) =>
        ctx.prisma.workspaceBilling.findUniqueOrThrow({ where: { workspaceId } })

    const onTrial = (workspaceId: string, endsIn = 20 * DAY) =>
        setBilling(workspaceId, { status: 'TRIAL', trialEndsAt: new Date(Date.now() + endsIn) })

    // A club that pays: an ACTIVE period ahead and VIDEO on its bill.
    const paying = async (workspaceId: string) => {
        await setBilling(workspaceId, {
            status: 'ACTIVE',
            trialEndsAt: new Date(Date.now() - 40 * DAY),
            currentPeriodEnd: new Date(Date.now() + 20 * DAY),
            setupFeePaidAt: new Date(Date.now() - 40 * DAY),
            convertedAt: new Date(Date.now() - 40 * DAY),
        })
        await ctx.prisma.workspaceModuleEntitlement.create({
            data: { workspaceId, module: 'VIDEO', mode: 'PAID' },
        })
    }

    const storedVideo = (workspaceId: string, sizeBytes: number) =>
        ctx.prisma.video.create({
            data: {
                workspaceId,
                title: 'Уже загружено',
                url: 'https://example.invalid/v.mp4',
                status: 'ready',
                sizeBytes: BigInt(Math.round(sizeBytes)),
                hlsBucket: 'test-bucket',
                hlsMasterKey: `hls/${workspaceId}/master.m3u8`,
                rawBucket: 'test-bucket',
                rawKey: `raw/${workspaceId}/source.mp4`,
                duration: 100,
            },
        })

    const startUpload = (c: Club, sizeBytes: number) =>
        ctx
            .http()
            .post('/admin/videos')
            .set(...c.actor.auth)
            .send({
                workspaceId: c.workspace.id,
                title: 'Разбор турнира',
                contentType: 'video/mp4',
                sizeBytes,
            })

    describe('video during the trial', () => {
        it('refuses an upload past the 2 GB trial cap with the CTA; a paying club is unaffected', async () => {
            const trial = await club()
            await onTrial(trial.workspace.id)
            await storedVideo(trial.workspace.id, 1.9 * GB)

            const refused = await startUpload(trial, 200 * 1024 ** 2).expect(403)
            expect(refused.body).toMatchObject({
                code: 'TRIAL_LIMIT_REACHED',
                metadata: { limit: 'VIDEO_STORAGE' },
            })
            expect(refused.body.message).toContain('2 ГБ')
            expect(refused.body.message).toContain('Оплатите тариф, чтобы снять ограничение')
            // Nothing was created for the refused file.
            expect(await ctx.prisma.video.count({ where: { workspaceId: trial.workspace.id } })).toBe(1)

            // What still fits goes through.
            await startUpload(trial, 50 * 1024 ** 2).expect(201)

            const paid = await club('Платящий клуб')
            await paying(paid.workspace.id)
            await storedVideo(paid.workspace.id, 1.9 * GB)
            await startUpload(paid, 200 * 1024 ** 2).expect(201)
        })

        it('past 10 hours watched this month: staff are told to pay, students get a neutral message', async () => {
            const setup = async (name: string) => {
                const c = await club(name)
                const { user } = await addMember(ctx, { workspaceId: c.workspace.id })
                const student = await signIn(ctx, user.email)
                const video = await storedVideo(c.workspace.id, 100)
                await ctx.prisma.course.create({
                    data: {
                        workspaceId: c.workspace.id,
                        title: 'Курс',
                        slug: `course-${c.workspace.id}`,
                        publishedAt: new Date(Date.now() - 60_000),
                        videos: { create: [{ videoId: video.id, order: 0 }] },
                    },
                })
                const now = new Date()
                await ctx.prisma.videoViewingMonth.create({
                    data: {
                        workspaceId: c.workspace.id,
                        month: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
                        seconds: 10 * 3600,
                    },
                })
                return { c, student, video }
            }
            const play = (videoId: string, actor: Actor) =>
                ctx.http().get(`/videos/${videoId}/playback`).set(...actor.auth)

            const trial = await setup('Клуб на пробном')
            await onTrial(trial.c.workspace.id)
            const staff = await play(trial.video.id, trial.c.actor).expect(403)
            expect(staff.body).toMatchObject({
                code: 'TRIAL_LIMIT_REACHED',
                metadata: { limit: 'VIDEO_VIEWING' },
            })
            expect(staff.body.message).toContain('10 ч')
            expect(staff.body.message).toContain('Оплатите тариф, чтобы снять ограничение')
            const member = await play(trial.video.id, trial.student).expect(403)
            expect(member.body.message).toBe(VIDEO_UNAVAILABLE_FOR_MEMBERS)
            expect(member.body.metadata).toEqual({})

            const paid = await setup('Платящий клуб')
            await paying(paid.c.workspace.id)
            await play(paid.video.id, paid.c.actor).expect(200)
            await play(paid.video.id, paid.student).expect(200)
        })
    })

    it('the branded app is not part of the trial or its quote', async () => {
        const c = await club()
        await onTrial(c.workspace.id)
        const res = await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/billing`)
            .set(...c.actor.auth)
            .expect(200)
        const modules = res.body.billing.modules as Array<{ code: string; entitled: boolean; source: string }>
        expect(modules.map((m) => [m.code, m.entitled, m.source])).toEqual([
            ['VIDEO', true, 'TRIAL'],
            ['ONLINE_PAYMENTS', true, 'TRIAL'],
            ['BRANDED_APP', false, 'NONE'],
        ])
        const codes = (q: { lines: Array<{ code: string }> }) => q.lines.map((l) => l.code)
        expect(codes(res.body.billing.quote)).not.toContain('module:BRANDED_APP')
        expect(codes(res.body.billing.checkout.monthly)).not.toContain('module:BRANDED_APP')
        expect(res.body.billing.trial).toMatchObject({
            limited: true,
            videoStorageGb: 2,
            videoViewHoursPerMonth: 10,
            cardTrial: false,
        })
    })

    it('card trial: only the platform owner switches it on; the check is refunded; the first period with the setup fee is charged once at trial end', async () => {
        const c = await club('Клуб с картой')
        const other = await club('Чужой клуб')
        await onTrial(c.workspace.id)
        const bindCard = (actor: Actor, workspaceId = c.workspace.id) =>
            ctx.http().post(`/workspaces/${workspaceId}/billing/card`).set(...actor.auth)
        const setCardTrial = (auth: [string, string], cardTrial: boolean | null) =>
            ctx
                .http()
                .post(`/platform/workspaces/${c.workspace.id}/billing`)
                .set(...auth)
                .send({ kind: 'setCardTrial', cardTrial })

        // Off by default (PLATFORM_CARD_TRIAL_ENABLED=false): the trial runs as today.
        await bindCard(c.actor).expect(400)
        // The club's owner and another club's owner cannot switch it.
        await setCardTrial(c.actor.auth, true).expect(403)
        await setCardTrial(other.actor.auth, true).expect(403)
        expect((await billingRow(c.workspace.id)).cardTrial).toBeNull()

        const switched = await setCardTrial(await platformAdmin(), true).expect(201)
        expect(switched.body.overrides.cardTrial).toBe(true)
        expect(switched.body.billing.trial.cardTrial).toBe(true)

        // Another club cannot bind a card to this one.
        await bindCard(other.actor).expect(403)

        const started = await bindCard(c.actor).expect(201)
        expect(started.body.confirmationUrl).toMatch(/^https:\/\/yookassa\.test\/confirm\//)
        expect(started.body.payment).toMatchObject({ kind: 'CARD_CHECK', amount: 1, status: 'PENDING' })
        expect(gateway.created[0].input).toMatchObject({ amount: 1, savePaymentMethod: true })

        const { providerPaymentId } = await ctx.prisma.platformPayment.findUniqueOrThrow({
            where: { id: started.body.payment.id },
        })
        gateway.pay(providerPaymentId!)
        await ctx
            .http()
            .post('/payments/webhooks/platform/yookassa')
            .send({ type: 'notification', event: 'payment.succeeded', object: { id: providerPaymentId } })
            .expect(200)

        let row = await billingRow(c.workspace.id)
        expect(row).toMatchObject({
            status: 'TRIAL',
            paymentMethodId: 'pm_1',
            setupFeePaidAt: null,
            convertedAt: null,
        })
        expect(gateway.refunds).toEqual([
            expect.objectContaining({ providerPaymentId, amount: 1 }),
        ])
        const check = await ctx.prisma.platformPayment.findUniqueOrThrow({
            where: { id: started.body.payment.id },
        })
        expect(check).toMatchObject({ status: 'REFUNDED', refundedAmount: 1 })
        // Nothing for the service during the trial: no setup fee in the check.
        expect(lineCodes(check.lines)).toEqual([
            'card-check',
        ])

        // Not due while the trial runs.
        expect(await ctx.app.get(PlatformAutopayService).runRenewals(new Date())).toEqual({})
        expect(gateway.savedCardCharges).toHaveLength(0)

        // The trial ends: the hourly pass charges, the nightly pass and
        // repeated runs (same key) charge nothing more.
        const trialEnd = new Date(Date.now() - HOUR)
        await setBilling(c.workspace.id, { trialEndsAt: trialEnd })
        const now = new Date()
        await ctx.app.get(PlatformAutopayService).runRenewals(now)
        await ctx.app.get(BillingLifecycleService).run(now)
        await ctx.app.get(PlatformAutopayService).runRenewals(now)
        await ctx.app.get(PlatformAutopayService).runRenewals(new Date(now.getTime() + 2 * HOUR))

        expect(gateway.savedCardCharges).toHaveLength(1)
        expect(gateway.savedCardCharges[0].input).toMatchObject({
            paymentMethodId: 'pm_1',
            amount: 2990 + 4990,
            idempotenceKey: `renewal:${c.workspace.id}:${trialEnd.toISOString()}:0`,
        })
        const periods = await ctx.prisma.platformPayment.findMany({
            where: { workspaceId: c.workspace.id, kind: 'PERIOD' },
        })
        expect(periods).toHaveLength(1)
        expect(periods[0]).toMatchObject({ status: 'SUCCEEDED', initiator: 'AUTOPAY', amount: 7980 })
        expect(lineCodes(periods[0].lines)).toEqual([
            'tier',
            'setup',
        ])
        row = await billingRow(c.workspace.id)
        expect(row.status).toBe('ACTIVE')
        expect(row.setupFeePaidAt).not.toBeNull()
        expect(row.convertedAt).not.toBeNull()
    })

    it('reminds the owner on day 23 and day 28 with the quote, once each', async () => {
        const c = await club('Клуб «Напоминание»')
        const trialEnd = new Date(Date.now() + 7 * DAY - HOUR)
        await onTrial(c.workspace.id, trialEnd.getTime() - Date.now())
        const reminders = () => ctx.app.get(TrialRemindersService)
        const sentRows = () =>
            ctx.prisma.notification.findMany({
                where: { userId: c.owner.id, type: 'EMAIL', metadata: { path: ['kind'], equals: TRIAL_REMINDER_KIND } },
                orderBy: { createdAt: 'asc' },
            })

        // Day 22: nothing yet.
        expect(await reminders().run(new Date(Date.now() - 2 * HOUR))).toBe(0)

        const day23 = new Date()
        expect(await reminders().run(day23)).toBe(1)
        expect(await reminders().run(day23)).toBe(0)
        let rows = await sentRows()
        expect(rows).toHaveLength(1)
        expect(rows[0].topic).toBe('Пробный период «Клуб «Напоминание»» закончится через 7 дней')
        // The quote: the tier and the setup fee the first charge will carry.
        expect(rows[0].message).toMatch(/7\s980 ₽/)
        expect(rows[0].message).toContain('Подключение (разово)')
        const mail = await ctx.mail.waitFor((m) => m.to === c.owner.email && m.subject.includes('закончится через 7 дней'))
        expect(mail.html).toContain('Открыть «Тариф»')
        expect(
            await ctx.prisma.notification.count({
                where: { userId: c.owner.id, type: 'PUSH', metadata: { path: ['kind'], equals: TRIAL_REMINDER_KIND } },
            }),
        ).toBe(1)

        const day28 = new Date(day23.getTime() + 5 * DAY)
        expect(await reminders().run(day28)).toBe(1)
        expect(await reminders().run(new Date(day28.getTime() + HOUR))).toBe(0)
        rows = await sentRows()
        expect(rows).toHaveLength(2)
        expect(rows[1].topic).toContain('закончится через 2 дня')

        // A club that already paid its first period during the trial: none.
        const paidEarly = await club('Оплатил заранее')
        await setBilling(paidEarly.workspace.id, {
            status: 'TRIAL',
            trialEndsAt: trialEnd,
            currentPeriodEnd: new Date(trialEnd.getTime() + 30 * DAY),
        })
        expect(await reminders().run(day23)).toBe(0)
    })

    it("a trial club's e-mails to people stop at the allowance; sign-in codes still arrive", async () => {
        const invite = (c: Club, email: string) =>
            ctx
                .http()
                .post(`/workspaces/${c.workspace.id}/members/invite`)
                .set(...c.actor.auth)
                .send({ email, role: 'user' })
                .expect(201)

        const trial = await club()
        await onTrial(trial.workspace.id)
        await setBilling(trial.workspace.id, { trialEmailsSent: 100 })
        const refused = await invite(trial, 'new-student@example.com')
        expect(refused.body).toMatchObject({ outcome: 'added', emailSent: false })
        expect(ctx.mail.sent.filter((m) => m.to === 'new-student@example.com')).toEqual([])

        // Sign-in codes are never counted: the student whose invitation was
        // not sent still gets the code and signs in.
        await signIn(ctx, 'new-student@example.com')

        await setBilling(trial.workspace.id, { trialEmailsSent: 99 })
        const last = await invite(trial, 'last-student@example.com')
        expect(last.body.emailSent).toBe(true)
        expect((await billingRow(trial.workspace.id)).trialEmailsSent).toBe(100)

        const paid = await club('Платящий клуб')
        await paying(paid.workspace.id)
        await setBilling(paid.workspace.id, { trialEmailsSent: 100 })
        expect((await invite(paid, 'paid-student@example.com')).body.emailSent).toBe(true)
    })

    it('onboarding help: the club asks, the console sees it, other clubs and non-admins cannot', async () => {
        const c = await club('Клуб «Помогите»')
        const other = await club('Чужой клуб')
        await onTrial(c.workspace.id)

        const asked = await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/onboarding-help`)
            .set(...c.actor.auth)
            .send({ phone: '+79990001122', message: 'Перенесите расписание' })
            .expect(201)
        expect(asked.body).toMatchObject({
            request: { status: 'OPEN', phone: '+79990001122', workspaceName: 'Клуб «Помогите»' },
            // Paid: the setup fee, with the first paid period.
            setupFee: { amount: 4990, state: 'DUE' },
        })
        // Asking again updates the open request.
        await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/onboarding-help`)
            .set(...c.actor.auth)
            .send({ message: 'И абонементы' })
            .expect(201)
        expect(await ctx.prisma.onboardingHelpRequest.count()).toBe(1)

        // Another club's owner, and a student of the club, are refused.
        await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/onboarding-help`)
            .set(...other.actor.auth)
            .send({})
            .expect(403)
        await ctx
            .http()
            .get(`/workspaces/${c.workspace.id}/onboarding-help`)
            .set(...other.actor.auth)
            .expect(403)
        const { user } = await addMember(ctx, { workspaceId: c.workspace.id })
        const student = await signIn(ctx, user.email)
        await ctx
            .http()
            .post(`/workspaces/${c.workspace.id}/onboarding-help`)
            .set(...student.auth)
            .send({})
            .expect(403)
        await ctx.http().get('/platform/onboarding-requests').set(...c.actor.auth).expect(403)

        const admin = await platformAdmin()
        // The platform waives the fee with the existing promo.
        await ctx
            .http()
            .post(`/platform/workspaces/${c.workspace.id}/promos`)
            .set(...admin)
            .send({ preset: 'NO_SETUP_FEE' })
            .expect(201)
        const queue = await ctx.http().get('/platform/onboarding-requests?status=OPEN').set(...admin).expect(200)
        expect(queue.body.data).toEqual([
            expect.objectContaining({
                id: asked.body.request.id,
                workspaceId: c.workspace.id,
                message: 'И абонементы',
                setupFee: { amount: 4990, state: 'WAIVED' },
            }),
        ])
        const overview = await ctx.http().get('/platform/overview').set(...admin).expect(200)
        expect(overview.body.openOnboardingRequestCount).toBe(1)

        await ctx
            .http()
            .post(`/platform/onboarding-requests/${asked.body.request.id}`)
            .set(...c.actor.auth)
            .send({ status: 'DONE' })
            .expect(403)
        const done = await ctx
            .http()
            .post(`/platform/onboarding-requests/${asked.body.request.id}`)
            .set(...admin)
            .send({ status: 'DONE', resolution: 'Настроили по видеосвязи' })
            .expect(201)
        expect(done.body).toMatchObject({ status: 'DONE', resolution: 'Настроили по видеосвязи' })
        expect(done.body.resolvedAt).not.toBeNull()
    })

    it('a club suspended for 30 days is archived: hidden from members, its payments and journal kept', async () => {
        const c = await club('Брошенный клуб')
        const { user } = await addMember(ctx, { workspaceId: c.workspace.id })
        const student = await signIn(ctx, user.email)
        await setBilling(c.workspace.id, {
            status: 'SUSPENDED',
            trialEndsAt: new Date(Date.now() - 70 * DAY),
            pastDueSince: new Date(Date.now() - 70 * DAY),
            suspendedAt: new Date(Date.now() - 29 * DAY),
        })
        await ctx.prisma.workspace.update({ where: { id: c.workspace.id }, data: { isListed: true } })
        await ctx.prisma.platformPayment.create({
            data: {
                workspaceId: c.workspace.id,
                kind: 'CARD_CHECK',
                initiator: 'OWNER',
                periodMonths: 1,
                amount: 1,
                currency: 'RUB',
                lines: { lines: [], discounts: [] },
                idempotenceKey: `kept-${c.workspace.id}`,
                status: 'REFUNDED',
            },
        })
        const myClubs = async (actor: Actor) =>
            (
                await ctx.http().post('/get-my-workspaces').set(...actor.auth).send({}).expect(201)
            ).body.data.map((w: { workspaceId: string }) => w.workspaceId)

        const lifecycle = ctx.app.get(BillingLifecycleService)
        expect((await lifecycle.run()).archived).toBe(0)
        expect(await myClubs(student)).toEqual([c.workspace.id])

        await setBilling(c.workspace.id, { suspendedAt: new Date(Date.now() - 31 * DAY) })
        expect((await lifecycle.run()).archived).toBe(1)
        expect((await lifecycle.run()).archived).toBe(0)

        const row = await billingRow(c.workspace.id)
        expect(row.status).toBe('SUSPENDED')
        expect(row.archivedAt).not.toBeNull()
        expect((await ctx.prisma.workspace.findUniqueOrThrow({ where: { id: c.workspace.id } })).isListed).toBe(false)
        expect(await myClubs(student)).toEqual([])
        // The owner still sees it, to pay and bring it back.
        expect(await myClubs(c.actor)).toEqual([c.workspace.id])
        expect(await ctx.prisma.platformPayment.count({ where: { workspaceId: c.workspace.id } })).toBe(1)
        expect(
            await ctx.prisma.auditEvent.count({
                where: { workspaceId: c.workspace.id, action: 'workspace.billingArchive' },
            }),
        ).toBe(1)
    })

    it('the console shows trial conversion and a club\'s trial cost', async () => {
        const at = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY)
        const converted = await club('Оплатил')
        await setBilling(converted.workspace.id, {
            status: 'ACTIVE',
            trialEndsAt: at(10),
            currentPeriodEnd: new Date(Date.now() + 20 * DAY),
            convertedAt: at(30),
            trialEmailsSent: 12,
        })
        await ctx.prisma.workspaceBilling.update({
            where: { workspaceId: converted.workspace.id },
            data: { createdAt: at(40) },
        })
        const lapsed = await club('Не оплатил')
        await setBilling(lapsed.workspace.id, {
            status: 'PAST_DUE',
            trialEndsAt: at(2),
            pastDueSince: at(2),
        })
        const running = await club('Ещё пробует')
        await onTrial(running.workspace.id)
        await storedVideo(running.workspace.id, 1 * GB)

        const admin = await platformAdmin()
        const overview = await ctx.http().get('/platform/overview').set(...admin).expect(200)
        expect(overview.body.trials).toEqual({
            started: 3,
            running: 1,
            converted: 1,
            conversionPercent: 50,
            averageDaysToConvert: 10,
        })

        const card = await ctx
            .http()
            .get(`/platform/workspaces/${running.workspace.id}/billing`)
            .set(...admin)
            .expect(200)
        expect(card.body.trialCost).toMatchObject({
            inTrial: true,
            storageBytes: GB,
            emailsSent: 0,
            convertedAt: null,
        })
        expect(card.body.overrides.cardTrial).toBeNull()
        const paidCard = await ctx
            .http()
            .get(`/platform/workspaces/${converted.workspace.id}/billing`)
            .set(...admin)
            .expect(200)
        expect(paidCard.body.trialCost).toMatchObject({ inTrial: false, emailsSent: 12 })
        expect(paidCard.body.trialCost.convertedAt).not.toBeNull()

        await ctx.http().get('/platform/overview').set(...converted.actor.auth).expect(403)
    })
})
