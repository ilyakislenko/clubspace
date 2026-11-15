import { MemberAutopayAgreementsService } from './member-autopay-agreements.service'

const ANCHOR = '11111111-1111-4111-8111-111111111111'
const now = new Date('2026-12-14T08:40:00Z') // 11:40 Moscow

const familyDiscount = {
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

const payment = (over: Record<string, unknown> = {}) => ({
    id: 'pay-1',
    workspaceId: 'ws-1',
    userId: 'u-1',
    planId: 'plan-1',
    planName: 'Безлимит',
    amount: 4500,
    currency: 'RUB',
    idempotenceKey: `autopay:${ANCHOR}:0`,
    autopayId: 'ap-1',
    autopayConsentVersion: null as string | null,
    receiptEmail: 'member@example.com',
    createdAt: new Date('2026-11-14T10:00:00Z'),
    ...over,
})

const row = (over: Record<string, unknown> = {}) => ({
    id: 'ap-1',
    workspaceId: 'ws-1',
    userId: 'u-1',
    planId: 'plan-1',
    planName: 'Безлимит',
    status: 'ACTIVE',
    failedAttempts: 0,
    attemptAnchorId: ANCHOR,
    termsAmount: 4500,
    currency: 'RUB',
    termsDurationDays: 30,
    termsClassCount: null,
    workspace: { timezone: 'Europe/Moscow' },
    user: { firstname: 'Иван', lastname: 'Петров' },
    ...over,
})

const build = (opts: {
    row?: Record<string, unknown> | null
    updateManyCount?: number
    family?: boolean
    others?: Array<Record<string, unknown>>
    existing?: Record<string, unknown> | null
    settings?: Record<string, unknown> | null
    live?: Array<{ id: string }>
} = {}) => {
    const db = {
        memberAutopay: {
            findUnique: jest.fn(async ({ where }: { where: { id?: string; liveKey?: string } }) =>
                where.liveKey !== undefined
                    ? (opts.existing ?? null)
                    : opts.row === undefined
                      ? row()
                      : opts.row,
            ),
            findUniqueOrThrow: jest.fn().mockResolvedValue({
                workspaceId: 'ws-1',
                userId: 'u-1',
                planId: 'plan-1',
                planName: 'Безлимит',
            }),
            findMany: jest.fn(async ({ where }: { where: { planId?: unknown } }) =>
                typeof where.planId === 'object' ? (opts.others ?? []) : (opts.live ?? []),
            ),
            updateMany: jest.fn().mockResolvedValue({ count: opts.updateManyCount ?? 1 }),
            update: jest.fn(async ({ data }) => ({ id: 'ap-1', ...data })),
            create: jest.fn(async ({ data }) => ({ id: 'ap-new', ...data })),
        },
        workspacePaymentSettings: {
            findUnique: jest.fn().mockResolvedValue(
                opts.settings === undefined ? { provider: 'YOOKASSA', shopId: 'shop-1' } : opts.settings,
            ),
        },
        plan: {
            findUnique: jest.fn().mockResolvedValue({
                id: 'plan-1',
                name: 'Безлимит',
                price: 4500,
                currency: 'RUB',
                durationDays: 30,
                classCount: null,
                updatedAt: new Date('2026-12-01T00:00:00Z'),
                directions: [],
                workspace: { name: 'Клуб', timezone: 'Europe/Moscow' },
            }),
        },
        workspace: {
            findUniqueOrThrow: jest.fn().mockResolvedValue({ timezone: 'Europe/Moscow' }),
            findUnique: jest.fn().mockResolvedValue({ timezone: 'Europe/Moscow' }),
        },
        payment: { update: jest.fn().mockResolvedValue({}) },
        discount: { findFirst: jest.fn().mockResolvedValue(opts.family ? familyDiscount : null) },
        guardianship: {
            findMany: jest
                .fn()
                .mockResolvedValue(opts.family ? [{ guardianId: 'p', dependentId: 'u-1' }] : []),
        },
        subscription: {
            findFirst: jest.fn().mockResolvedValue(opts.family ? { id: 'sibling' } : null),
            findMany: jest.fn().mockResolvedValue([
                { endDate: new Date('2026-12-14T21:00:00Z'), directions: [] },
            ]),
        },
        user: { findUnique: jest.fn().mockResolvedValue({ firstname: 'Иван', lastname: 'Петров' }) },
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const notices = {
        chargeFailed: jest.fn().mockResolvedValue(undefined),
        cancelled: jest.fn().mockResolvedValue(undefined),
        staffAlert: jest.fn().mockResolvedValue(undefined),
        termsChanged: jest.fn().mockResolvedValue(undefined),
    }
    const realtime = { invalidate: jest.fn() }
    const service = new MemberAutopayAgreementsService(
        db as never,
        audit as never,
        notices as never,
        realtime as never,
    )
    return { service, db, audit, notices, realtime }
}

const savedCard = {
    providerPaymentId: 'yk-1',
    status: 'SUCCEEDED' as const,
    confirmationUrl: null,
    amountMinor: 405000,
    currency: 'RUB',
    paymentMethod: { id: 'pm-1', saved: true, title: 'Bank card *4444', cardLast4: '4444' },
}

describe('MemberAutopayAgreementsService.setUpFromPaymentInTx', () => {
    const setupPayment = payment({ autopayId: null, autopayConsentVersion: '2026-11-15', amount: 4050 })

    it('creates the agreement with the renewal price, the granted terms and the card hints only', async () => {
        const s = build({ family: true })
        const out = await s.service.setUpFromPaymentInTx(
            s.db as never,
            setupPayment,
            savedCard,
            { durationDays: 30, classesTotal: null },
            now,
        )
        expect(out).toMatchObject({ autopayId: 'ap-new', termsAmount: 4050, cardLast4: '4444', replaced: [] })
        expect(s.db.memberAutopay.create.mock.calls[0][0].data).toMatchObject({
            workspaceId: 'ws-1',
            userId: 'u-1',
            planId: 'plan-1',
            liveKey: 'u-1:plan-1',
            provider: 'YOOKASSA',
            status: 'ACTIVE',
            paymentMethodId: 'pm-1',
            paymentMethodTitle: 'Bank card *4444',
            cardLast4: '4444',
            shopId: 'shop-1',
            receiptEmail: 'member@example.com',
            termsAmount: 4050,
            currency: 'RUB',
            termsDurationDays: 30,
            termsClassCount: null,
            consentVersion: '2026-11-15',
            consentedAt: setupPayment.createdAt,
        })
        expect(s.db.payment.update).toHaveBeenCalledWith({
            where: { id: 'pay-1' },
            data: { autopayId: 'ap-new' },
        })
    })

    it('re-arms this tariff’s live agreement and replaces a same-scope one on another tariff', async () => {
        const s = build({
            existing: { id: 'ap-1' },
            others: [
                { id: 'ap-old', plan: { directions: [] } },
                { id: 'ap-bjj', plan: { directions: [{ directionId: 'bjj' }] } },
            ],
        })
        const out = await s.service.setUpFromPaymentInTx(
            s.db as never,
            setupPayment,
            savedCard,
            { durationDays: 30, classesTotal: null },
            now,
        )
        expect(s.db.memberAutopay.update.mock.calls[0][0]).toMatchObject({
            where: { id: 'ap-1' },
            data: { status: 'ACTIVE', needsActionReason: null, failedAttempts: 0, paymentMethodId: 'pm-1' },
        })
        expect(s.db.memberAutopay.create).not.toHaveBeenCalled()
        expect(s.db.memberAutopay.updateMany).toHaveBeenCalledTimes(1)
        expect(s.db.memberAutopay.updateMany.mock.calls[0][0]).toMatchObject({
            where: { id: 'ap-old', status: { not: 'CANCELLED' } },
            data: { status: 'CANCELLED', paymentMethodId: null, liveKey: null, cancelSource: 'SYSTEM' },
        })
        expect(out?.replaced.map((r) => r.id)).toEqual(['ap-old'])
        await s.service.announceSetUp(setupPayment, out!)
        expect(s.audit.record.mock.calls.map((c) => c[0].action)).toEqual([
            'autopay.enabled',
            'autopay.cancelled',
        ])
        expect(s.notices.cancelled.mock.calls[0][0]).toMatchObject({
            autopayId: 'ap-old',
            reason: 'заменён новым автоплатежом',
        })
    })

    it('makes no agreement when the card was not saved or the club is not on YooKassa', async () => {
        const s = build()
        expect(
            await s.service.setUpFromPaymentInTx(
                s.db as never,
                setupPayment,
                { ...savedCard, paymentMethod: { ...savedCard.paymentMethod, saved: false } },
                { durationDays: 30, classesTotal: null },
                now,
            ),
        ).toBeNull()
        const stripe = build({ settings: { provider: 'STRIPE', shopId: null } })
        expect(
            await stripe.service.setUpFromPaymentInTx(
                stripe.db as never,
                setupPayment,
                savedCard,
                { durationDays: 30, classesTotal: null },
                now,
            ),
        ).toBeNull()
        expect(s.db.memberAutopay.create).not.toHaveBeenCalled()
    })
})

describe('MemberAutopayAgreementsService renewal outcomes', () => {
    it('a success resets the attempts and keeps the lower of the agreed and the charged amount', async () => {
        const s = build()
        await s.service.onChargeSucceededInTx(s.db as never, { autopayId: 'ap-1', amount: 4050 }, now)
        expect(s.db.memberAutopay.update).toHaveBeenCalledWith({
            where: { id: 'ap-1' },
            data: {
                status: 'ACTIVE',
                needsActionReason: null,
                failedAttempts: 0,
                attemptAnchorId: null,
                nextAttemptAt: null,
                lastError: null,
                lastChargedAt: now,
                termsAmount: 4050,
            },
        })
    })

    it('schedules the next attempt after a decline; staff hear only the first', async () => {
        const s = build()
        await s.service.onChargeDeclined(payment(), 'insufficient_funds', now)
        expect(s.db.memberAutopay.updateMany).toHaveBeenCalledWith({
            where: { id: 'ap-1', status: 'ACTIVE', failedAttempts: 0 },
            data: {
                failedAttempts: 1,
                attemptAnchorId: ANCHOR,
                lastError: 'на карте недостаточно средств',
                nextAttemptAt: new Date('2026-12-15T07:00:00Z'),
            },
        })
        expect(s.audit.record.mock.calls[0][0]).toMatchObject({
            action: 'autopay.chargeFailed',
            metadata: { attempt: 1, reason: 'insufficient_funds' },
        })
        expect(s.notices.chargeFailed.mock.calls[0][0]).toMatchObject({
            nextAttemptAt: new Date('2026-12-15T07:00:00Z'),
        })
        expect(s.notices.staffAlert).toHaveBeenCalledTimes(1)

        const second = build({ row: row({ failedAttempts: 1 }) })
        await second.service.onChargeDeclined(
            payment({ idempotenceKey: `autopay:${ANCHOR}:1` }),
            'insufficient_funds',
            now,
        )
        expect(second.notices.chargeFailed).toHaveBeenCalled()
        expect(second.notices.staffAlert).not.toHaveBeenCalled()
    })

    it('stops after the 4th decline and on an expired card, telling staff', async () => {
        const fourth = build({ row: row({ failedAttempts: 3 }) })
        await fourth.service.onChargeDeclined(
            payment({ idempotenceKey: `autopay:${ANCHOR}:3` }),
            'insufficient_funds',
            now,
        )
        expect(fourth.db.memberAutopay.updateMany.mock.calls[0][0].data).toMatchObject({
            failedAttempts: 4,
            nextAttemptAt: null,
            status: 'NEEDS_ACTION',
            needsActionReason: 'CHARGE_FAILED',
        })
        expect(fourth.notices.chargeFailed.mock.calls[0][0].nextAttemptAt).toBeNull()
        expect(fourth.notices.staffAlert.mock.calls[0][0].message).toContain('остановлен')

        const expired = build()
        await expired.service.onChargeDeclined(payment(), 'card_expired', now)
        expect(expired.db.memberAutopay.updateMany.mock.calls[0][0].data).toMatchObject({
            status: 'NEEDS_ACTION',
            needsActionReason: 'CARD_EXPIRED',
            nextAttemptAt: null,
        })
    })

    it('cancels at once and wipes the token when the payer revoked the permission', async () => {
        const s = build()
        await s.service.onChargeDeclined(payment(), 'permission_revoked', now)
        expect(s.db.memberAutopay.updateMany).toHaveBeenCalledTimes(2)
        expect(s.db.memberAutopay.updateMany.mock.calls[1][0]).toMatchObject({
            where: { id: 'ap-1', status: { not: 'CANCELLED' } },
            data: { status: 'CANCELLED', paymentMethodId: null, liveKey: null, cancelSource: 'SYSTEM' },
        })
        expect(s.notices.cancelled).toHaveBeenCalled()
        expect(s.notices.chargeFailed).not.toHaveBeenCalled()
        expect(s.notices.staffAlert.mock.calls[0][0].message).toContain('отключён')
    })

    it('counts a decline once (CAS on the attempt) and ignores a stopped agreement', async () => {
        const raced = build({ updateManyCount: 0 })
        await raced.service.onChargeDeclined(payment(), 'insufficient_funds', now)
        expect(raced.audit.record).not.toHaveBeenCalled()
        expect(raced.notices.chargeFailed).not.toHaveBeenCalled()
        const cancelled = build({ row: row({ status: 'CANCELLED' }) })
        await cancelled.service.onChargeDeclined(payment(), 'insufficient_funds', now)
        expect(cancelled.db.memberAutopay.updateMany).not.toHaveBeenCalled()
    })

    it('stops on a paid renewal that was not granted and alerts staff to refund or grant', async () => {
        const s = build()
        await s.service.onGrantRefused(payment(), 'Абонемент уже продлён')
        expect(s.db.memberAutopay.updateMany).toHaveBeenCalledWith({
            where: { id: 'ap-1', status: 'ACTIVE' },
            data: {
                status: 'NEEDS_ACTION',
                needsActionReason: 'GRANT_REFUSED',
                attemptAnchorId: ANCHOR,
                nextAttemptAt: null,
                lastError: 'Абонемент уже продлён',
            },
        })
        expect(s.notices.staffAlert.mock.calls[0][0]).toMatchObject({
            path: 'subscriptions/payments',
            message: expect.stringContaining('Верните деньги в «Платежах»'),
        })
    })
})

describe('MemberAutopayAgreementsService.cancel', () => {
    it('cancels with the token wiped, audits the member as actor and confirms without a reason', async () => {
        const s = build()
        await s.service.cancel({ id: 'ap-1', source: 'MEMBER', actorId: 'u-1', now })
        expect(s.db.memberAutopay.updateMany).toHaveBeenCalledWith({
            where: { id: 'ap-1', status: { not: 'CANCELLED' } },
            data: {
                status: 'CANCELLED',
                liveKey: null,
                paymentMethodId: null,
                needsActionReason: null,
                nextAttemptAt: null,
                cancelledAt: now,
                cancelSource: 'MEMBER',
                cancelledById: null,
                cancelReason: null,
            },
        })
        expect(s.audit.record.mock.calls[0][0]).toMatchObject({
            action: 'autopay.cancelled',
            targetId: 'u-1',
            actorId: 'u-1',
            metadata: { autopayId: 'ap-1', source: 'MEMBER' },
        })
        expect(s.notices.cancelled.mock.calls[0][0]).toMatchObject({
            reason: null,
            accessUntil: new Date('2026-12-14T21:00:00Z'),
        })
    })

    it('records the staff member and the reason; is idempotent', async () => {
        const s = build()
        await s.service.cancel({ id: 'ap-1', source: 'STAFF', actorId: 'coach-1', reason: 'Попросил по телефону' })
        expect(s.db.memberAutopay.updateMany.mock.calls[0][0].data).toMatchObject({
            cancelSource: 'STAFF',
            cancelledById: 'coach-1',
            cancelReason: 'Попросил по телефону',
        })
        expect(s.audit.record.mock.calls[0][0].actorId).toBe('coach-1')
        expect(s.notices.cancelled.mock.calls[0][0].reason).toBe('Попросил по телефону')

        const again = build({ updateManyCount: 0 })
        await again.service.cancel({ id: 'ap-1', source: 'MEMBER', actorId: 'u-1' })
        expect(again.audit.record).not.toHaveBeenCalled()
        expect(again.notices.cancelled).not.toHaveBeenCalled()
    })

    it('cancels every live agreement of a member, a tariff or a club', async () => {
        const s = build({ live: [{ id: 'ap-1' }, { id: 'ap-2' }] })
        expect(await s.service.cancelForUser('ws-1', 'u-1', 'участник больше не в клубе')).toBe(2)
        expect(s.db.memberAutopay.findMany.mock.calls[0][0].where).toEqual({
            userId: 'u-1',
            workspaceId: 'ws-1',
            status: { not: 'CANCELLED' },
        })
        await s.service.cancelForUser(null, 'u-1', 'аккаунт удалён')
        expect(s.db.memberAutopay.findMany.mock.calls[1][0].where).toEqual({
            userId: 'u-1',
            status: { not: 'CANCELLED' },
        })
        await s.service.cancelForPlan('plan-1', 'x')
        expect(s.db.memberAutopay.findMany.mock.calls[2][0].where).toMatchObject({ planId: 'plan-1' })
        await s.service.cancelForWorkspace('ws-1', 'x')
        expect(s.db.memberAutopay.findMany.mock.calls[3][0].where).toMatchObject({ workspaceId: 'ws-1' })
    })
})

describe('MemberAutopayAgreementsService.notifyTermsChanged', () => {
    it('tells only the members whose agreed terms the tariff now exceeds', async () => {
        const s = build()
        s.db.memberAutopay.findMany.mockResolvedValue([
            row({ id: 'ap-cheaper', termsAmount: 4000 }),
            row({ id: 'ap-same', termsAmount: 4500 }),
        ])
        expect(await s.service.notifyTermsChanged('plan-1')).toBe(1)
        expect(s.notices.termsChanged.mock.calls[0][0]).toMatchObject({
            autopayId: 'ap-cheaper',
            refId: `ap-cheaper:plan:${new Date('2026-12-01T00:00:00Z').getTime()}`,
            before: { amount: 4000 },
            after: { amount: 4500 },
        })
    })
})
