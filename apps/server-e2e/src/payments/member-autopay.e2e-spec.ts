import { AUTOPAY_CONSENT_VERSION } from '../../../server/src/domains/autopay/autopay-consent'
import { MemberAutopayAgreementsService } from '../../../server/src/domains/autopay/member-autopay-agreements.service'
import { MemberAutopayService } from '../../../server/src/domains/autopay/member-autopay.service'
import { PaymentGatewayError } from '../../../server/src/domains/payments/payment-gateway.types'
import { addDaysYmd } from '../../../server/src/domains/subscriptions/freeze-dates'
import { environment } from '../../../server/src/environments/environment'
import {
    localDateInTz,
    wallClockToUtc,
} from '../../../server/src/features/attendance/attendance-utils'
import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { type Actor, signIn } from '../support/actors'
import { FakeGateway } from '../support/fake-payment-gateway'
import { addMember, createPlan, createWorkspace } from '../support/fixtures'
import { createTestApp, resetDatabase, TestApp } from '../support/test-app'

// Member autopay end to end (docs/design/2026-11-15-member-autopay.md §9):
// the checkout with the switch → the activation sets up the agreement → the
// hourly pass (called with a chosen `now`, as the platform autopay specs do)
// charges the saved card through the fake YooKassa → the same activation path
// grants the next abonement. Everything but the provider is real.
describe('member autopay', () => {
    let ctx: TestApp
    const gateway = new FakeGateway()
    const env = environment as { memberAutopay: { enabled: boolean } }
    let wasEnabled: boolean

    beforeAll(async () => {
        wasEnabled = env.memberAutopay.enabled
        env.memberAutopay.enabled = true
        ctx = await createTestApp({ paymentGateway: gateway })
    })
    afterAll(async () => {
        env.memberAutopay.enabled = wasEnabled
        await ctx?.close()
    })
    beforeEach(async () => {
        await resetDatabase(ctx.prisma)
        await ctx.seed.onApplicationBootstrap()
        ctx.mail.clear()
        gateway.reset()
    })

    const pass = () => ctx.app.get(MemberAutopayService)

    type Setup = Awaited<ReturnType<typeof setup>>
    const setup = async (plan: { price?: number; classCount?: number | null } = {}) => {
        const { workspace, owner } = await createWorkspace(ctx, { name: 'Клуб' })
        const { user: memberUser } = await addMember(ctx, { workspaceId: workspace.id })
        const { user: headCoachUser } = await addMember(ctx, {
            workspaceId: workspace.id,
            role: RolesEnum.HEAD_COACH,
        })
        const tariff = await createPlan(ctx, {
            workspaceId: workspace.id,
            name: 'Безлимит',
            price: plan.price ?? 4500,
            classCount: plan.classCount === undefined ? null : plan.classCount,
            durationDays: 30,
        })
        const ownerActor = await signIn(ctx, owner.email)
        const memberActor = await signIn(ctx, memberUser.email)
        await ctx
            .http()
            .put(`/workspaces/${workspace.id}/payment-settings`)
            .set(...ownerActor.auth)
            .send({ provider: 'YOOKASSA', shopId: '123456', secretKey: 'live_secret_0001' })
            .expect(200)
        await ctx
            .http()
            .patch(`/workspaces/${workspace.id}/plans/${tariff.id}`)
            .set(...ownerActor.auth)
            .send({ purchasableOnline: true })
            .expect(200)
        // The two club-side switches (their admin surfaces have their own specs).
        await ctx.prisma.workspacePaymentSettings.update({
            where: { workspaceId: workspace.id },
            data: { autopayEnabled: true },
        })
        await ctx.prisma.plan.update({ where: { id: tariff.id }, data: { autopayAvailable: true } })
        return { workspace, owner, ownerActor, memberUser, memberActor, headCoachUser, plan: tariff }
    }

    const checkout = (s: Setup, actor: Actor, body: Record<string, unknown>) =>
        ctx
            .http()
            .post(`/workspaces/${s.workspace.id}/payments`)
            .set(...actor.auth)
            .send({ planId: s.plan.id, ...body })

    // The member pays with the switch on; YooKassa confirms through the webhook.
    const setUpAutopay = async (s: Setup) => {
        const created = await checkout(s, s.memberActor, {
            autopay: true,
            autopayConsentVersion: AUTOPAY_CONSENT_VERSION,
        }).expect(201)
        const providerId = gateway.created[gateway.created.length - 1]
        const id = (await ctx.prisma.payment.findUniqueOrThrow({ where: { id: created.body.payment.id } }))
            .providerPaymentId as string
        expect(providerId.input.savePaymentMethod).toBe(true)
        gateway.setStatus(id, 'SUCCEEDED')
        await ctx
            .http()
            .post(`/payments/webhooks/yookassa/${s.workspace.id}`)
            .send({ type: 'notification', event: 'payment.succeeded', object: { id } })
            .expect(200)
        const agreement = await ctx.prisma.memberAutopay.findFirstOrThrow({
            where: { workspaceId: s.workspace.id, userId: s.memberUser.id, status: { not: 'CANCELLED' } },
        })
        const anchor = await ctx.prisma.subscription.findFirstOrThrow({
            where: { workspaceId: s.workspace.id, userId: s.memberUser.id },
            orderBy: { createdAt: 'desc' },
        })
        return { paymentId: created.body.payment.id as string, agreement, anchor }
    }

    const tzOf = async (s: Setup) =>
        (await ctx.prisma.workspace.findUniqueOrThrow({ where: { id: s.workspace.id } })).timezone
    const at = (ymd: string, hm: string, tz: string) => wallClockToUtc(`${ymd}T${hm}`, tz)

    // Moves the abonement so that it renews on club-local day `s` (30 days).
    const renewOn = async (subId: string, s: string, tz: string) =>
        ctx.prisma.subscription.update({
            where: { id: subId },
            data: { startDate: at(addDaysYmd(s, -30), '00:00', tz), endDate: at(s, '00:00', tz) },
        })

    const subsOf = (s: Setup) =>
        ctx.prisma.subscription.findMany({
            where: { workspaceId: s.workspace.id, userId: s.memberUser.id },
            orderBy: { createdAt: 'asc' },
        })
    // Push / inbox rows of a kind (the e-mail copies are EMAIL rows).
    const kinds = async (userId: string, kind: string) =>
        (await ctx.prisma.notification.findMany({ where: { userId, type: 'PUSH' } })).filter(
            (n) => (n.metadata as { kind?: string } | null)?.kind === kind,
        )
    const charges = () => gateway.created.filter((c) => c.input.paymentMethodId)

    it('sets up from the checkout, reminds, charges at S − 1 10:00 back to back, once, into the journal and revenue', async () => {
        const s = await setup()
        const options = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/me/online-purchase`)
            .set(...s.memberActor.auth)
            .expect(200)
        expect(options.body.plans[0].autopay).toMatchObject({
            renewalAmount: 4500,
            consentVersion: AUTOPAY_CONSENT_VERSION,
        })
        expect(options.body.autopayTermsUrl).toMatch(/\/legal\/autopay$/)

        const { paymentId, agreement, anchor } = await setUpAutopay(s)
        expect(agreement).toMatchObject({
            status: 'ACTIVE',
            planId: s.plan.id,
            provider: 'YOOKASSA',
            paymentMethodId: 'pm_yk_1',
            cardLast4: '4444',
            shopId: '123456',
            termsAmount: 4500,
            termsDurationDays: 30,
            termsClassCount: null,
            consentVersion: AUTOPAY_CONSENT_VERSION,
            liveKey: `${s.memberUser.id}:${s.plan.id}`,
        })
        const mine = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/me/payments/${paymentId}`)
            .set(...s.memberActor.auth)
            .expect(200)
        expect(mine.body.autopay).toBe('on')
        const [setupPush] = await kinds(s.memberUser.id, 'payment.succeeded')
        expect(setupPush.message).toContain('Автоплатёж включён: следующее списание —')
        expect(
            (
                await ctx
                    .http()
                    .get(`/workspaces/${s.workspace.id}/me/online-purchase`)
                    .set(...s.memberActor.auth)
            ).body.plans[0].autopay,
        ).toBeNull()

        // The abonement renews yesterday (club-local): S − 1 was two days ago,
        // so the charge lands inside revenue_30d.
        const tz = await tzOf(s)
        const today = localDateInTz(new Date(), tz)
        const S = addDaysYmd(today, -1)
        await renewOn(anchor.id, S, tz)

        expect(await pass().runReminders(at(addDaysYmd(S, -4), '11:00', tz))).toBe(1)
        await pass().runReminders(at(addDaysYmd(S, -4), '12:00', tz))
        const reminders = await kinds(s.memberUser.id, 'subscription.autopay_reminder')
        expect(reminders).toHaveLength(1)
        expect(reminders[0].message).toContain('•• 4444')

        expect(await pass().runCharges(at(addDaysYmd(S, -2), '12:00', tz))).toEqual({ SKIPPED: 1 })
        expect(charges()).toHaveLength(0)

        // Two passes at once (an overlapping replica): one charge.
        const due = at(addDaysYmd(S, -1), '12:00', tz)
        const runs = await Promise.all([pass().runCharges(due), pass().runCharges(due)])
        expect(runs.map((r) => r.CHARGED ?? 0).reduce((a, b) => a + b, 0)).toBe(1)
        expect(charges()).toHaveLength(1)
        expect(charges()[0].input).toMatchObject({
            idempotenceKey: `autopay:${anchor.id}:0`,
            paymentMethodId: 'pm_yk_1',
            amount: 4500,
            customerEmail: s.memberUser.email,
        })
        const subs = await subsOf(s)
        expect(subs).toHaveLength(2)
        expect(subs[1]).toMatchObject({
            source: 'GATEWAY',
            isPaid: true,
            amountPaid: 4500,
            startDate: at(S, '00:00', tz),
        })
        const renewal = await ctx.prisma.payment.findFirstOrThrow({
            where: { subscriptionId: subs[1].id },
        })
        expect(renewal).toMatchObject({ autopayId: agreement.id, status: 'SUCCEEDED', autopayConsentVersion: null })
        expect(await ctx.prisma.memberAutopay.findUniqueOrThrow({ where: { id: agreement.id } })).toMatchObject({
            status: 'ACTIVE',
            failedAttempts: 0,
            lastChargedAt: due,
        })
        const chargedPush = (await kinds(s.memberUser.id, 'payment.succeeded')).find((n) =>
            n.message.startsWith('Автоплатёж: списали'),
        )
        expect(chargedPush).toBeDefined()

        // A second run, later the same day, or two at once: nothing more.
        await pass().runCharges(due)
        await Promise.all([
            pass().runCharges(new Date(due.getTime() + 60 * 60 * 1000)),
            pass().runCharges(new Date(due.getTime() + 60 * 60 * 1000)),
        ])
        expect(charges()).toHaveLength(1)
        expect(await subsOf(s)).toHaveLength(2)

        // «Платежи»: the charge is an online sale marked autopay; «Итого» = revenue.
        const journal = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/payment-journal`)
            .set(...s.ownerActor.auth)
            .expect(200)
        const autopayRows = journal.body.data.filter(
            (e: { online: { autopay: boolean } | null }) => e.online?.autopay,
        )
        expect(autopayRows).toHaveLength(1)
        expect(journal.body.totals[0].net).toBe(9000)
        const stats = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/stats`)
            .set(...s.ownerActor.auth)
            .expect(200)
        expect(stats.body.revenue.revenue30d).toBe(journal.body.totals[0].net)
    })

    it('declines 4 times over ~5 days (S − 1, S, S + 1, S + 3), stops, shows it to staff, and is re-armed by a new card', async () => {
        const s = await setup()
        const { agreement, anchor } = await setUpAutopay(s)
        const tz = await tzOf(s)
        const S = localDateInTz(anchor.endDate as Date, tz)
        gateway.charges = Array.from({ length: 4 }, () => ({
            status: 'CANCELED' as const,
            cancellationReason: 'insufficient_funds',
        }))

        expect(await pass().runCharges(at(addDaysYmd(S, -1), '10:30', tz))).toEqual({ DECLINED: 1 })
        let row = await ctx.prisma.memberAutopay.findUniqueOrThrow({ where: { id: agreement.id } })
        expect(row).toMatchObject({
            status: 'ACTIVE',
            failedAttempts: 1,
            attemptAnchorId: anchor.id,
            lastError: 'на карте недостаточно средств',
            nextAttemptAt: at(S, '10:00', tz),
        })
        // Not before the scheduled retry.
        await pass().runCharges(at(addDaysYmd(S, -1), '15:00', tz))
        expect(charges()).toHaveLength(1)

        await pass().runCharges(at(S, '10:30', tz))
        await pass().runCharges(at(addDaysYmd(S, 1), '10:30', tz))
        row = await ctx.prisma.memberAutopay.findUniqueOrThrow({ where: { id: agreement.id } })
        expect(row.nextAttemptAt).toEqual(at(addDaysYmd(S, 3), '10:00', tz))
        expect(await pass().runCharges(at(addDaysYmd(S, 3), '10:30', tz))).toEqual({ DECLINED: 1 })
        row = await ctx.prisma.memberAutopay.findUniqueOrThrow({ where: { id: agreement.id } })
        expect(row).toMatchObject({
            status: 'NEEDS_ACTION',
            needsActionReason: 'CHARGE_FAILED',
            failedAttempts: 4,
            nextAttemptAt: null,
        })
        expect(charges().map((c) => c.input.idempotenceKey)).toEqual(
            [0, 1, 2, 3].map((n) => `autopay:${anchor.id}:${n}`),
        )
        const failedRows = await ctx.prisma.payment.findMany({
            where: { autopayId: agreement.id, status: 'CANCELED' },
        })
        expect(failedRows).toHaveLength(4)
        expect(failedRows.every((p) => p.failureReason === 'insufficient_funds')).toBe(true)
        expect(await kinds(s.memberUser.id, 'subscription.autopay_failed')).toHaveLength(4)
        // Staff: the first decline and the stop only.
        expect(await kinds(s.owner.id, 'subscription.autopay_staff_alert')).toHaveLength(2)
        expect(await ctx.prisma.subscription.count({ where: { userId: s.memberUser.id } })).toBe(1)

        // Stopped: the pass waits for the member.
        await pass().runCharges(at(addDaysYmd(S, 4), '10:30', tz))
        expect(charges()).toHaveLength(4)

        // «Удержание → Продлить» lists it (no amount), next to the receivable.
        const awaiting = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/awaiting-payment`)
            .set(...s.ownerActor.auth)
            .expect(200)
        expect(awaiting.body.autopayAttention.total).toBe(1)
        expect(awaiting.body.autopayAttention.data[0]).toMatchObject({
            autopayId: agreement.id,
            reason: 'CHARGE_FAILED',
        })
        expect(awaiting.body.autopayAttention.data[0]).not.toHaveProperty('amount')

        // Paying again with the switch on saves a new card and re-arms it.
        await setUpAutopay(s)
        const rearmed = await ctx.prisma.memberAutopay.findUniqueOrThrow({ where: { id: agreement.id } })
        expect(rearmed).toMatchObject({
            status: 'ACTIVE',
            needsActionReason: null,
            failedAttempts: 0,
            paymentMethodId: 'pm_yk_6',
        })
        expect(await ctx.prisma.memberAutopay.count()).toBe(1)
    })

    it('cancels at once on permission_revoked and after a cancel never charges, the token wiped', async () => {
        const s = await setup()
        const { agreement, anchor } = await setUpAutopay(s)
        const tz = await tzOf(s)
        const S = localDateInTz(anchor.endDate as Date, tz)
        gateway.charges = [{ status: 'CANCELED', cancellationReason: 'permission_revoked' }]
        await pass().runCharges(at(addDaysYmd(S, -1), '10:30', tz))
        expect(await ctx.prisma.memberAutopay.findUniqueOrThrow({ where: { id: agreement.id } })).toMatchObject({
            status: 'CANCELLED',
            cancelSource: 'SYSTEM',
            paymentMethodId: null,
            liveKey: null,
        })
        expect(await kinds(s.memberUser.id, 'subscription.autopay_cancelled')).toHaveLength(1)
        await pass().runCharges(at(S, '10:30', tz))
        expect(charges()).toHaveLength(1)

        // A fresh agreement (paid over the live abonement) cancelled by the
        // member: nothing at its S − 1.
        const second = await setUpAutopay(s)
        await ctx.app.get(MemberAutopayAgreementsService).cancel({
            id: second.agreement.id,
            source: 'MEMBER',
            actorId: s.memberUser.id,
        })
        const S2 = localDateInTz(second.anchor.endDate as Date, tz)
        expect(await pass().runCharges(at(addDaysYmd(S2, -1), '10:30', tz))).toEqual({})
        expect(charges()).toHaveLength(1)
        expect(
            await ctx.prisma.memberAutopay.findUniqueOrThrow({ where: { id: second.agreement.id } }),
        ).toMatchObject({ status: 'CANCELLED', cancelSource: 'MEMBER', paymentMethodId: null })
    })

    it('never charges a price rise until the member accepts it; charges a drop as is', async () => {
        const s = await setup()
        const { agreement, anchor } = await setUpAutopay(s)
        const tz = await tzOf(s)
        const S = localDateInTz(anchor.endDate as Date, tz)
        await ctx.prisma.plan.update({ where: { id: s.plan.id }, data: { price: 5000 } })

        expect(await pass().runCharges(at(addDaysYmd(S, -1), '10:30', tz))).toEqual({ NEEDS_ACTION: 1 })
        expect(charges()).toHaveLength(0)
        expect(await ctx.prisma.memberAutopay.findUniqueOrThrow({ where: { id: agreement.id } })).toMatchObject({
            status: 'NEEDS_ACTION',
            needsActionReason: 'TERMS_CHANGED',
        })
        await pass().runCharges(at(addDaysYmd(S, -1), '11:30', tz))
        expect(await kinds(s.memberUser.id, 'subscription.autopay_terms_changed')).toHaveLength(1)
        expect(charges()).toHaveLength(0)

        await ctx
            .http()
            .post(`/workspaces/${s.workspace.id}/me/autopays/${agreement.id}/accept-terms`)
            .set(...s.memberActor.auth)
            .send({ amount: 5000, durationDays: 30, classCount: null, consentVersion: AUTOPAY_CONSENT_VERSION })
            .expect(201)
        expect(await pass().runCharges(at(addDaysYmd(S, -1), '12:30', tz))).toEqual({ CHARGED: 1 })
        expect(charges()[0].input.amount).toBe(5000)

        // The next period at a lower price: charged lower, the terms follow.
        await ctx.prisma.plan.update({ where: { id: s.plan.id }, data: { price: 4000 } })
        const next = (await subsOf(s))[1]
        const S2 = localDateInTz(next.endDate as Date, tz)
        expect(await pass().runCharges(at(addDaysYmd(S2, -1), '10:30', tz))).toEqual({ CHARGED: 1 })
        expect(charges()[1].input.amount).toBe(4000)
        expect(
            (await ctx.prisma.memberAutopay.findUniqueOrThrow({ where: { id: agreement.id } })).termsAmount,
        ).toBe(4000)
    })

    it('skips a period the club already sold by hand (cash renewal moves the anchor)', async () => {
        const s = await setup()
        const { anchor } = await setUpAutopay(s)
        const tz = await tzOf(s)
        const S = localDateInTz(anchor.endDate as Date, tz)
        const member = await ctx.prisma.workspaceMember.findFirstOrThrow({
            where: { workspaceId: s.workspace.id, userId: s.memberUser.id },
        })
        await ctx.prisma.subscription.create({
            data: {
                workspaceId: s.workspace.id,
                planId: s.plan.id,
                workspaceMemberId: member.id,
                userId: s.memberUser.id,
                startDate: at(S, '00:00', tz),
                endDate: at(addDaysYmd(S, 30), '00:00', tz),
                durationDays: 30,
                amountPaid: 4500,
                currency: 'RUB',
                isPaid: true,
                paidAt: new Date(),
                paymentMethod: 'CASH',
            },
        })
        expect(await pass().runCharges(at(addDaysYmd(S, -1), '10:30', tz))).toEqual({ SKIPPED: 1 })
        expect(charges()).toHaveLength(0)
        // It renews after the cash period instead.
        expect(await pass().runCharges(at(addDaysYmd(S, 29), '10:30', tz))).toEqual({ CHARGED: 1 })
    })

    it('a crash mid-charge re-sends the same Idempotence-Key and charges once', async () => {
        const s = await setup()
        const { anchor } = await setUpAutopay(s)
        const tz = await tzOf(s)
        const S = localDateInTz(anchor.endDate as Date, tz)
        // The request reached YooKassa (it charged) but the answer was lost.
        gateway.charges = [
            { error: new PaymentGatewayError('timeout', null, null), landed: 'SUCCEEDED' },
        ]
        const t = at(addDaysYmd(S, -1), '10:30', tz)
        expect(await pass().runCharges(t)).toEqual({ SKIPPED: 1 })
        const pending = await ctx.prisma.payment.findFirstOrThrow({
            where: { idempotenceKey: `autopay:${anchor.id}:0` },
        })
        expect(pending).toMatchObject({ status: 'PENDING', providerPaymentId: null })
        // Too young to re-send (another run may still be sending it).
        await pass().runCharges(new Date(t.getTime() + 5 * 60 * 1000))
        expect(charges()).toHaveLength(1)
        expect(await pass().runCharges(new Date(t.getTime() + 15 * 60 * 1000))).toEqual({ CHARGED: 1 })
        expect(charges().map((c) => c.input.idempotenceKey)).toEqual([
            `autopay:${anchor.id}:0`,
            `autopay:${anchor.id}:0`,
        ])
        expect(await subsOf(s)).toHaveLength(2)
        expect(await ctx.prisma.payment.count({ where: { idempotenceKey: { startsWith: 'autopay:' } } })).toBe(1)
    })

    it('refuses the switch where it is not offered and keeps one-off payments unsaved', async () => {
        const s = await setup()
        await ctx.prisma.plan.update({ where: { id: s.plan.id }, data: { autopayAvailable: false } })
        const refused = await checkout(s, s.memberActor, {
            autopay: true,
            autopayConsentVersion: AUTOPAY_CONSENT_VERSION,
        })
        expect(refused.status).toBe(400)
        expect(refused.body.message).toBe('Автоплатёж для этого тарифа недоступен')
        await ctx.prisma.plan.update({ where: { id: s.plan.id }, data: { autopayAvailable: true } })
        const stale = await checkout(s, s.memberActor, { autopay: true, autopayConsentVersion: '2020-01-01' })
        expect(stale.status).toBe(400)

        const oneOff = await checkout(s, s.memberActor, {}).expect(201)
        expect(gateway.created[0].input.savePaymentMethod).toBe(false)
        const id = (await ctx.prisma.payment.findUniqueOrThrow({ where: { id: oneOff.body.payment.id } }))
            .providerPaymentId as string
        gateway.setStatus(id, 'SUCCEEDED')
        await ctx
            .http()
            .post(`/payments/webhooks/yookassa/${s.workspace.id}`)
            .send({ type: 'notification', event: 'payment.succeeded', object: { id } })
            .expect(200)
        expect(await ctx.prisma.memberAutopay.count()).toBe(0)
        const mine = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/me/payments/${oneOff.body.payment.id}`)
            .set(...s.memberActor.auth)
        expect(mine.body.autopay).toBeNull()
    })

    it('says so when YooKassa did not save the card: the abonement, no agreement', async () => {
        const s = await setup()
        gateway.saveCards = false
        const created = await checkout(s, s.memberActor, {
            autopay: true,
            autopayConsentVersion: AUTOPAY_CONSENT_VERSION,
        }).expect(201)
        const id = (await ctx.prisma.payment.findUniqueOrThrow({ where: { id: created.body.payment.id } }))
            .providerPaymentId as string
        gateway.setStatus(id, 'SUCCEEDED')
        await ctx
            .http()
            .post(`/payments/webhooks/yookassa/${s.workspace.id}`)
            .send({ type: 'notification', event: 'payment.succeeded', object: { id } })
            .expect(200)
        expect(await ctx.prisma.memberAutopay.count()).toBe(0)
        expect(await subsOf(s)).toHaveLength(1)
        const mine = await ctx
            .http()
            .get(`/workspaces/${s.workspace.id}/me/payments/${created.body.payment.id}`)
            .set(...s.memberActor.auth)
        expect(mine.body.autopay).toBe('not_saved')
        const [push] = await kinds(s.memberUser.id, 'payment.succeeded')
        expect(push.message).toContain('Автоплатёж не подключился')
    })

    it('records a YooKassa refusal of the setup for the settings card and the admins', async () => {
        const s = await setup()
        gateway.checkoutErrors = [
            new PaymentGatewayError('refused', 403, 'Recurring payments are not available'),
        ]
        const res = await checkout(s, s.memberActor, {
            autopay: true,
            autopayConsentVersion: AUTOPAY_CONSENT_VERSION,
        })
        expect(res.status).toBe(400)
        expect(res.body.message).toBe(
            'Не удалось подключить автоплатёж — оплатите без него или обратитесь в клуб',
        )
        expect(
            await ctx.prisma.workspacePaymentSettings.findUniqueOrThrow({
                where: { workspaceId: s.workspace.id },
            }),
        ).toMatchObject({ autopayLastError: 'Recurring payments are not available' })
        expect(await kinds(s.owner.id, 'subscription.autopay_staff_alert')).toHaveLength(1)
        // The member can still pay without it.
        await checkout(s, s.memberActor, {}).expect(201)
    })
})
