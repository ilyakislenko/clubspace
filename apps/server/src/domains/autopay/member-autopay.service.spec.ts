jest.mock('../../environments/environment', () => ({
    environment: {
        encryptionKey: 'unit-test-encryption-key',
        appUrl: 'https://app.example.com',
        memberAutopay: { enabled: true },
        billing: { enabled: true },
    },
}))

import { encryptPaymentSecret } from '../payments/payment-credentials'
import { PaymentGatewayError } from '../payments/payment-gateway.types'
import { MemberAutopayService } from './member-autopay.service'

const ANCHOR = '11111111-1111-4111-8111-111111111111'
// 11:40 Moscow on S − 1 (the anchor ends at Moscow midnight of 2026-12-15).
const now = new Date('2026-12-14T08:40:00Z')

const settings = (over: Record<string, unknown> = {}) => ({
    workspaceId: 'ws-1',
    provider: 'YOOKASSA',
    shopId: 'shop-1',
    secretKeyEncrypted: encryptPaymentSecret('live_key_1234', 'unit-test-encryption-key'),
    webhookSecretEncrypted: null,
    receiptEnabled: true,
    vatCode: 1,
    paymentSubject: 'service',
    paymentMode: 'full_prepayment',
    autopayEnabled: true,
    ...over,
})

const agreement = (over: Record<string, unknown> = {}) => ({
    id: 'ap-1',
    workspaceId: 'ws-1',
    userId: 'u-1',
    planId: 'plan-1',
    planName: 'Безлимит',
    status: 'ACTIVE',
    needsActionReason: null,
    provider: 'YOOKASSA',
    paymentMethodId: 'pm-1',
    paymentMethodTitle: 'Bank card *4444',
    cardLast4: '4444',
    shopId: 'shop-1',
    receiptEmail: 'old@example.com',
    termsAmount: 4500,
    currency: 'RUB',
    termsDurationDays: 30,
    termsClassCount: null,
    failedAttempts: 0,
    attemptAnchorId: ANCHOR,
    nextAttemptAt: null,
    plan: {
        id: 'plan-1',
        name: 'Безлимит',
        price: 4500,
        currency: 'RUB',
        durationDays: 30,
        classCount: null,
        isActive: true,
        purchasableOnline: true,
        autopayAvailable: true,
        directions: [],
    },
    workspace: {
        name: 'Клуб',
        timezone: 'Europe/Moscow',
        type: 'GRAPPLING',
        subscriptionEnabled: true,
        billing: null,
        moduleEntitlements: [],
        paymentSettings: settings(),
    },
    user: { email: 'member@example.com' },
    ...over,
})

const anchor = (over: Record<string, unknown> = {}) => ({
    id: ANCHOR,
    status: 'ACTIVE',
    startDate: new Date('2026-11-14T21:00:00Z'),
    endDate: new Date('2026-12-14T21:00:00Z'),
    classesTotal: null as number | null,
    classesRemaining: null as number | null,
    durationDays: 30,
    createdAt: new Date('2026-11-14T10:00:00Z'),
    updatedAt: new Date('2026-11-14T10:00:00Z'),
    directions: [],
    consumedRecords: [] as Array<{ markedAt: Date }>,
    ...over,
})

const paymentRow = (data: Record<string, unknown>) => ({
    id: 'pay-1',
    status: 'PENDING',
    providerPaymentId: null,
    createdAt: now,
    ...data,
})

const build = (opts: {
    agreement?: Record<string, unknown> | null
    member?: Record<string, unknown> | null
    subs?: Array<Record<string, unknown>>
    inflight?: Record<string, unknown> | null
    existing?: Record<string, unknown> | null
    createError?: unknown
    updateManyCount?: number
    family?: Record<string, unknown> | null
} = {}) => {
    const prisma = {
        memberAutopay: {
            findUnique: jest
                .fn()
                .mockResolvedValue(opts.agreement === undefined ? agreement() : opts.agreement),
            findMany: jest.fn().mockResolvedValue([]),
            updateMany: jest.fn().mockResolvedValue({ count: opts.updateManyCount ?? 1 }),
        },
        workspaceMember: {
            findFirst: jest
                .fn()
                .mockResolvedValue(opts.member === undefined ? { id: 'm-1' } : opts.member),
        },
        subscription: {
            findMany: jest.fn().mockResolvedValue(opts.subs ?? [anchor()]),
            findFirst: jest.fn().mockResolvedValue(null),
        },
        payment: {
            findFirst: jest.fn().mockResolvedValue(opts.inflight ?? null),
            findUnique: jest.fn().mockResolvedValue(opts.existing ?? null),
            create: opts.createError
                ? jest.fn().mockRejectedValue(opts.createError)
                : jest.fn(async ({ data }) => paymentRow(data)),
            update: jest.fn().mockResolvedValue({}),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        discount: { findFirst: jest.fn().mockResolvedValue(opts.family ?? null) },
        guardianship: { findMany: jest.fn().mockResolvedValue([]) },
        workspace: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Europe/Moscow' }) },
    }
    const gateway = {
        createPayment: jest.fn().mockResolvedValue({
            providerPaymentId: 'yk-9',
            status: 'SUCCEEDED',
            confirmationUrl: null,
            amountMinor: 450000,
            currency: 'RUB',
        }),
    }
    const activation = { applyProviderStatus: jest.fn().mockResolvedValue('activated') }
    const agreements = {
        cancel: jest.fn().mockResolvedValue(null),
        onChargeDeclined: jest.fn().mockResolvedValue(undefined),
    }
    const notices = {
        reminder: jest.fn().mockResolvedValue(undefined),
        packLow: jest.fn().mockResolvedValue(undefined),
        termsChanged: jest.fn().mockResolvedValue(undefined),
    }
    const service = new MemberAutopayService(
        prisma as never,
        gateway as never,
        activation as never,
        agreements as never,
        notices as never,
    )
    return { service, prisma, gateway, activation, agreements, notices }
}

describe('MemberAutopayService.chargeOne', () => {
    it('charges the saved card once per renewed abonement and attempt, through the activation', async () => {
        const s = build()
        const out = await s.service.chargeOne('ap-1', now)
        expect(out).toEqual({ outcome: 'CHARGED', reason: null, sent: true })
        expect(s.prisma.payment.create.mock.calls[0][0].data).toEqual({
            workspaceId: 'ws-1',
            userId: 'u-1',
            planId: 'plan-1',
            planName: 'Безлимит',
            provider: 'YOOKASSA',
            amount: 4500,
            listPrice: 4500,
            discountId: null,
            discountName: null,
            discountAmount: 0,
            currency: 'RUB',
            idempotenceKey: `autopay:${ANCHOR}:0`,
            receiptEmail: 'member@example.com',
            autopayId: 'ap-1',
            createdAt: now,
        })
        const [creds, input] = s.gateway.createPayment.mock.calls[0]
        expect(creds).toMatchObject({ provider: 'YOOKASSA', shopId: 'shop-1' })
        expect(input).toMatchObject({
            paymentId: 'pay-1',
            idempotenceKey: `autopay:${ANCHOR}:0`,
            amount: 4500,
            paymentMethodId: 'pm-1',
            customerEmail: 'member@example.com',
            itemName: 'Абонемент «Безлимит»',
            description: 'Автоплатёж: абонемент «Безлимит» — Клуб',
        })
        expect(input.savePaymentMethod).toBeUndefined()
        expect(s.prisma.payment.update).toHaveBeenCalledWith({
            where: { id: 'pay-1' },
            data: { providerPaymentId: 'yk-9' },
        })
        expect(s.activation.applyProviderStatus).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            gateway: expect.objectContaining({ providerPaymentId: 'yk-9' }),
            now,
        })
    })

    it('sends the receipt to the e-mail given at consent when the member has none now', async () => {
        const s = build({ agreement: agreement({ user: { email: null } }) })
        await s.service.chargeOne('ap-1', now)
        expect(s.prisma.payment.create.mock.calls[0][0].data.receiptEmail).toBe('old@example.com')
    })

    it('skips what is already charged or being charged; re-sends an old unanswered one with the same key', async () => {
        const done = build({ existing: paymentRow({ status: 'SUCCEEDED', idempotenceKey: `autopay:${ANCHOR}:0` }) })
        expect(await done.service.chargeOne('ap-1', now)).toMatchObject({
            outcome: 'SKIPPED',
            reason: 'Этот период уже списан',
        })
        expect(done.gateway.createPayment).not.toHaveBeenCalled()

        const young = build({ existing: paymentRow({ createdAt: new Date(now.getTime() - 60_000) }) })
        expect(await young.service.chargeOne('ap-1', now)).toMatchObject({
            reason: 'Этот период уже списывается',
        })
        expect(young.gateway.createPayment).not.toHaveBeenCalled()

        const old = build({
            existing: paymentRow({
                id: 'pay-0',
                idempotenceKey: `autopay:${ANCHOR}:0`,
                amount: 4500,
                currency: 'RUB',
                receiptEmail: 'member@example.com',
                createdAt: new Date(now.getTime() - 20 * 60_000),
            }),
        })
        await old.service.chargeOne('ap-1', now)
        expect(old.prisma.payment.create).not.toHaveBeenCalled()
        expect(old.gateway.createPayment.mock.calls[0][1]).toMatchObject({
            paymentId: 'pay-0',
            idempotenceKey: `autopay:${ANCHOR}:0`,
        })
    })

    it('never re-sends a request whose answer has been missing for 20 h (the provider key may have expired)', async () => {
        const lost = build({
            existing: paymentRow({
                idempotenceKey: `autopay:${ANCHOR}:0`,
                createdAt: new Date(now.getTime() - 21 * 60 * 60_000),
            }),
        })
        expect(await lost.service.chargeOne('ap-1', now)).toMatchObject({
            outcome: 'SKIPPED',
            reason: 'Ответ платёжной системы потерян — сверьте платёж в личном кабинете ЮKassa',
        })
        expect(lost.gateway.createPayment).not.toHaveBeenCalled()
    })

    it('a concurrent run that created the row first wins (P2002 → skip)', async () => {
        const s = build({ createError: { code: 'P2002' } })
        expect(await s.service.chargeOne('ap-1', now)).toMatchObject({ outcome: 'SKIPPED' })
        expect(s.gateway.createPayment).not.toHaveBeenCalled()
    })

    it('waits for an in-flight member checkout or earlier charge', async () => {
        const s = build({ inflight: { id: 'pay-x' } })
        expect(await s.service.chargeOne('ap-1', now)).toMatchObject({
            outcome: 'SKIPPED',
            reason: 'Предыдущий платёж ещё обрабатывается',
        })
        const where = s.prisma.payment.findFirst.mock.calls[0][0].where
        expect(where).toMatchObject({
            userId: 'u-1',
            planId: 'plan-1',
            status: 'PENDING',
            idempotenceKey: { not: `autopay:${ANCHOR}:0` },
        })
        expect(s.prisma.payment.create).not.toHaveBeenCalled()
    })

    it('leaves the row PENDING on a network error or 5xx, declines on another 4xx', async () => {
        const down = build()
        down.gateway.createPayment.mockRejectedValue(new PaymentGatewayError('x', 503, null))
        expect(await down.service.chargeOne('ap-1', now)).toMatchObject({
            outcome: 'SKIPPED',
            sent: true,
        })
        expect(down.prisma.payment.updateMany).not.toHaveBeenCalled()
        expect(down.agreements.onChargeDeclined).not.toHaveBeenCalled()

        const refused = build()
        refused.gateway.createPayment.mockRejectedValue(
            new PaymentGatewayError('x', 400, 'Payment method is not available'),
        )
        expect(await refused.service.chargeOne('ap-1', now)).toMatchObject({ outcome: 'DECLINED' })
        expect(refused.prisma.payment.updateMany).toHaveBeenCalledWith({
            where: { id: 'pay-1', status: 'PENDING' },
            data: { status: 'CANCELED', failureReason: 'Payment method is not available' },
        })
        expect(refused.agreements.onChargeDeclined).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'pay-1' }),
            'Payment method is not available',
            now,
        )
    })

    it('maps the activation outcome', async () => {
        const pending = build()
        pending.gateway.createPayment.mockResolvedValue({
            providerPaymentId: 'yk-9',
            status: 'PENDING',
            confirmationUrl: null,
            amountMinor: 450000,
            currency: 'RUB',
        })
        pending.activation.applyProviderStatus.mockResolvedValue('unchanged')
        expect(await pending.service.chargeOne('ap-1', now)).toMatchObject({ outcome: 'PENDING' })
        const declined = build()
        declined.activation.applyProviderStatus.mockResolvedValue('canceled')
        expect(await declined.service.chargeOne('ap-1', now)).toMatchObject({ outcome: 'DECLINED' })
        const refused = build()
        refused.activation.applyProviderStatus.mockResolvedValue('paid-not-activated')
        expect(await refused.service.chargeOne('ap-1', now)).toMatchObject({ outcome: 'NEEDS_ACTION' })
    })

    it('is not due before S − 1 10:00 nor outside the 10–20 window', async () => {
        const early = build()
        expect(await early.service.chargeOne('ap-1', new Date('2026-12-14T06:40:00Z'))).toMatchObject({
            reason: 'Срок списания ещё не наступил',
        })
        const evening = build()
        expect(await evening.service.chargeOne('ap-1', new Date('2026-12-14T17:40:00Z'))).toMatchObject({
            reason: 'Вне дневного окна 10:00–20:00',
        })
        expect(evening.gateway.createPayment).not.toHaveBeenCalled()
    })

    it('starts a new cycle on a new anchor: attempts reset, a failed stop re-activated', async () => {
        const s = build({
            agreement: agreement({
                status: 'NEEDS_ACTION',
                needsActionReason: 'CHARGE_FAILED',
                failedAttempts: 4,
                attemptAnchorId: 'old-anchor',
            }),
        })
        await s.service.chargeOne('ap-1', now)
        expect(s.prisma.memberAutopay.updateMany.mock.calls[0][0]).toEqual({
            where: {
                id: 'ap-1',
                status: 'NEEDS_ACTION',
                attemptAnchorId: 'old-anchor',
                failedAttempts: 4,
            },
            data: {
                attemptAnchorId: ANCHOR,
                failedAttempts: 0,
                nextAttemptAt: null,
                lastError: null,
                status: 'ACTIVE',
                needsActionReason: null,
            },
        })
        expect(s.prisma.payment.create.mock.calls[0][0].data.idempotenceKey).toBe(`autopay:${ANCHOR}:0`)
    })

    it('waits for the member while stopped on the same anchor', async () => {
        const s = build({
            agreement: agreement({ status: 'NEEDS_ACTION', needsActionReason: 'CHARGE_FAILED', failedAttempts: 4 }),
        })
        expect(await s.service.chargeOne('ap-1', now)).toMatchObject({ reason: 'Ждёт ученика' })
        expect(s.gateway.createPayment).not.toHaveBeenCalled()
    })

    it('stops on a price rise with one notice, never charging the new amount', async () => {
        const s = build({ agreement: agreement({ termsAmount: 4000 }) })
        expect(await s.service.chargeOne('ap-1', now)).toMatchObject({ outcome: 'NEEDS_ACTION' })
        expect(s.prisma.memberAutopay.updateMany).toHaveBeenCalledWith({
            where: { id: 'ap-1', status: 'ACTIVE' },
            data: { status: 'NEEDS_ACTION', needsActionReason: 'TERMS_CHANGED' },
        })
        expect(s.notices.termsChanged.mock.calls[0][0]).toMatchObject({
            refId: `ap-1:${ANCHOR}`,
            before: { amount: 4000 },
            after: { amount: 4500 },
        })
        expect(s.gateway.createPayment).not.toHaveBeenCalled()
    })

    it('charges a lower price (the family discount) as is', async () => {
        const family = {
            id: 'd-family',
            name: 'Семейная',
            kind: 'PERCENT',
            value: 10,
            currency: null,
            code: null,
            isFamily: true,
            allPlans: true,
            events: false,
            startsOn: null,
            endsOn: null,
            maxUses: null,
            oncePerMember: false,
            isActive: true,
            plans: [],
        }
        const s = build({ family })
        s.prisma.guardianship.findMany.mockResolvedValue([{ guardianId: 'p', dependentId: 'u-1' }])
        s.prisma.subscription.findFirst.mockResolvedValue({ id: 'sibling' })
        await s.service.chargeOne('ap-1', now)
        expect(s.prisma.payment.create.mock.calls[0][0].data).toMatchObject({
            amount: 4050,
            discountId: 'd-family',
        })
    })

    it('cancels (safety net) when the tariff, the club setting, the shop or the member is gone, or it lapsed', async () => {
        const plan = agreement().plan
        const ws = agreement().workspace
        const cases: Array<[Record<string, unknown>, string]> = [
            [{ member: null }, 'участник больше не в клубе'],
            [{ agreement: agreement({ plan: null }) }, 'клуб больше не продлевает этот тариф автоматически'],
            [{ agreement: agreement({ plan: { ...plan, isActive: false } }) }, 'клуб больше не продлевает этот тариф автоматически'],
            [{ agreement: agreement({ plan: { ...plan, autopayAvailable: false } }) }, 'клуб больше не продлевает этот тариф автоматически'],
            [{ agreement: agreement({ workspace: { ...ws, paymentSettings: settings({ autopayEnabled: false }) } }) }, 'клуб отключил автоплатежи'],
            [{ agreement: agreement({ workspace: { ...ws, paymentSettings: settings({ shopId: 'shop-2' }) } }) }, 'клуб сменил платёжную систему'],
            [{ agreement: agreement({ workspace: { ...ws, paymentSettings: settings({ provider: 'STRIPE' }) } }) }, 'клуб сменил платёжную систему'],
            [{ subs: [anchor({ endDate: new Date('2026-11-01T21:00:00Z') })] }, 'давно не продлевался'],
            [{ subs: [anchor({ status: 'CANCELLED' })] }, 'абонемент отменён клубом'],
        ]
        for (const [opts, reason] of cases) {
            const s = build(opts)
            expect(await s.service.chargeOne('ap-1', now)).toEqual({ outcome: 'CANCELLED', reason })
            expect(s.agreements.cancel).toHaveBeenCalledWith({ id: 'ap-1', source: 'SYSTEM', reason, now })
            expect(s.gateway.createPayment).not.toHaveBeenCalled()
        }
    })

    it('skips without a state change while the club is not entitled or the section is off', async () => {
        const ws = agreement().workspace
        for (const workspace of [
            { ...ws, billing: { status: 'ACTIVE' } },
            { ...ws, subscriptionEnabled: false },
        ]) {
            const s = build({ agreement: agreement({ workspace }) })
            expect(await s.service.chargeOne('ap-1', now)).toMatchObject({ outcome: 'SKIPPED' })
            expect(s.agreements.cancel).not.toHaveBeenCalled()
            expect(s.prisma.memberAutopay.updateMany).not.toHaveBeenCalled()
        }
    })

    it('never charges a pack while classes remain; charges 1 h after the last check-in', async () => {
        const pack = (over: Record<string, unknown>) =>
            anchor({ classesTotal: 8, durationDays: 30, ...over })
        const noon = new Date('2026-11-20T09:40:00Z') // 12:40 Moscow, well before the term end
        const left = build({ subs: [pack({ classesRemaining: 2 })], agreement: agreement({ termsClassCount: 8, plan: { ...agreement().plan, classCount: 8 } }) })
        expect(await left.service.chargeOne('ap-1', noon)).toMatchObject({ reason: 'Срок списания ещё не наступил' })
        const fresh = build({
            subs: [pack({ classesRemaining: 0, consumedRecords: [{ markedAt: new Date('2026-11-20T09:10:00Z') }] })],
            agreement: agreement({ termsClassCount: 8, plan: { ...agreement().plan, classCount: 8 } }),
        })
        expect(await fresh.service.chargeOne('ap-1', noon)).toMatchObject({ reason: 'Срок списания ещё не наступил' })
        const used = build({
            subs: [pack({ classesRemaining: 0, consumedRecords: [{ markedAt: new Date('2026-11-20T08:30:00Z') }] })],
            agreement: agreement({ termsClassCount: 8, plan: { ...agreement().plan, classCount: 8 } }),
        })
        expect(await used.service.chargeOne('ap-1', noon)).toMatchObject({ outcome: 'CHARGED' })
    })
})

describe('MemberAutopayService.runCharges', () => {
    it('goes through each candidate page by page; one failure never stops the run', async () => {
        const s = build()
        s.prisma.memberAutopay.findMany
            .mockResolvedValueOnce([{ id: 'ap-1' }, { id: 'ap-2' }])
            .mockResolvedValueOnce([])
        s.prisma.memberAutopay.findUnique
            .mockRejectedValueOnce(new Error('db hiccup'))
            .mockResolvedValueOnce(agreement({ id: 'ap-2' }))
        const counts = await s.service.runCharges(now)
        expect(counts).toEqual({ CHARGED: 1 })
        expect(s.prisma.memberAutopay.findMany.mock.calls[0][0]).toMatchObject({
            orderBy: { id: 'asc' },
            take: 200,
        })
        expect(s.prisma.memberAutopay.findMany.mock.calls[0][0].where.OR).toEqual([
            { status: 'ACTIVE' },
            {
                status: 'NEEDS_ACTION',
                needsActionReason: { in: ['CHARGE_FAILED', 'GRANT_REFUSED', 'TERMS_CHANGED'] },
            },
        ])
    })
})

describe('MemberAutopayService.runReminders', () => {
    const reminderDay = new Date('2026-12-11T08:40:00Z') // S − 4, 11:40 Moscow

    it('reminds 3 days before the charge with the amount and the card', async () => {
        const s = build()
        s.prisma.memberAutopay.findMany.mockResolvedValueOnce([{ id: 'ap-1' }])
        expect(await s.service.runReminders(reminderDay)).toBe(1)
        expect(s.notices.reminder.mock.calls[0][0]).toMatchObject({
            autopayId: 'ap-1',
            anchorId: ANCHOR,
            amount: 4500,
            lower: false,
            cardLast4: '4444',
            dueAt: new Date('2026-12-14T07:00:00Z'),
        })
        expect(s.prisma.memberAutopay.findMany.mock.calls[0][0].where).toEqual({ status: 'ACTIVE' })
    })

    it('sends nothing before the reminder day or outside the window', async () => {
        const early = build()
        early.prisma.memberAutopay.findMany.mockResolvedValueOnce([{ id: 'ap-1' }])
        expect(await early.service.runReminders(new Date('2026-12-10T08:40:00Z'))).toBe(0)
        const night = build()
        night.prisma.memberAutopay.findMany.mockResolvedValueOnce([{ id: 'ap-1' }])
        expect(await night.service.runReminders(new Date('2026-12-11T19:00:00Z'))).toBe(0)
        expect(night.notices.reminder).not.toHaveBeenCalled()
    })

    it('replaces the reminder by the terms-changed stop when the price rose', async () => {
        const s = build({ agreement: agreement({ termsAmount: 4000 }) })
        s.prisma.memberAutopay.findMany.mockResolvedValueOnce([{ id: 'ap-1' }])
        await s.service.runReminders(reminderDay)
        expect(s.notices.reminder).not.toHaveBeenCalled()
        expect(s.notices.termsChanged).toHaveBeenCalled()
    })

    it('tells a pack holder when one class is left', async () => {
        const s = build({
            subs: [anchor({ classesTotal: 8, classesRemaining: 1 })],
            agreement: agreement({ termsClassCount: 8, plan: { ...agreement().plan, classCount: 8 } }),
        })
        s.prisma.memberAutopay.findMany.mockResolvedValueOnce([{ id: 'ap-1' }])
        await s.service.runReminders(new Date('2026-11-25T08:40:00Z'))
        expect(s.notices.packLow.mock.calls[0][0]).toMatchObject({ anchorId: ANCHOR, amount: 4500 })
        expect(s.notices.reminder).not.toHaveBeenCalled()
        // The reminders pass never cancels.
        const gone = build({ member: null })
        gone.prisma.memberAutopay.findMany.mockResolvedValueOnce([{ id: 'ap-1' }])
        await gone.service.runReminders(reminderDay)
        expect(gone.agreements.cancel).not.toHaveBeenCalled()
    })
})
