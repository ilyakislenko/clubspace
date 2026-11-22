jest.mock('../../environments/environment', () => ({
    environment: { encryptionKey: 'unit-test-encryption-key' },
}))
jest.mock('../payment-journal/payment-journal-detail', () => ({
    loadPaymentJournalDetail: jest.fn(),
}))

import { Logger } from '@nestjs/common'

import { encryptPaymentSecret } from '../../domains/payments/payment-credentials'
import { PaymentGatewayError } from '../../domains/payments/payment-gateway.types'
import {
    REFUND_CONFLICT,
    REFUND_NEEDS_RECEIPT_EMAIL,
    REFUND_NEEDS_RECONCILIATION,
    REFUND_NOT_ONLINE,
    REFUND_PROVIDER_OFF,
    REFUND_UNAPPLIED_ONLINE_ONLY,
    RefundService,
} from '../../domains/payments/services/refund.service'
import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { loadPaymentJournalDetail } from '../payment-journal/payment-journal-detail'
import { CreateRefundFeature } from './create-refund.feature'
import { CreateRefundHandler } from './create-refund.handler'

const KEY = 'unit-test-encryption-key'
const OWNER_ID = 'owner-1'
const SUB_ID = '0d4e8f1a-2b3c-4d5e-8f90-a1b2c3d4e5f6'
const REG_ID = '1e5f9a2b-3c4d-4e6f-9a01-b2c3d4e5f6a7'
const PAY_ID = '2f6a0b3c-4d5e-4f70-8b12-c3d4e5f6a7b8'
const NOW = new Date('2026-11-15T10:00:00Z')

const rbac = () => ({
    resolveCoachScope: jest.fn(
        async (p: { userId: string; workspaceId: string; roleName: string | null }) => ({
            scope: p.roleName === 'coach' ? 'coach_own_only' : 'admin',
            userId: p.userId,
            workspaceId: p.workspaceId,
            workspaceOwnerId: OWNER_ID,
        }),
    ),
    canWriteAllGroups: jest.fn((ctx: { scope: string }) => ctx.scope === 'admin'),
})

type Caller = { userId: string; roleName: string }
const ADMIN: Caller = { userId: 'a-1', roleName: 'admin' }
// The owner has no member row; whatever role name arrives, they pass.
const OWNER: Caller = { userId: OWNER_ID, roleName: 'user' }

const online = (over: Record<string, unknown> = {}) => ({
    id: PAY_ID,
    provider: 'YOOKASSA',
    providerPaymentId: 'yk-1',
    status: 'SUCCEEDED',
    amount: 4000,
    currency: 'RUB',
    refundedAmount: 0,
    receiptEmail: 'buyer@x.ru',
    activationError: null,
    user: { email: 'current@x.ru' },
    ...over,
})

const subscription = (over: Record<string, unknown> = {}) => ({
    id: SUB_ID,
    amountPaid: 4000,
    refundedAmount: 0,
    currency: 'RUB',
    userId: 'u-1',
    workspaceMember: { userId: 'u-1' },
    plan: { name: 'Безлимит' },
    payment: null,
    ...over,
})

const ticket = (over: Record<string, unknown> = {}) => ({
    id: REG_ID,
    amountPaid: 1500,
    refundedAmount: 0,
    currency: 'RUB',
    paymentMethod: 'CASH',
    userId: 'u-2',
    eventId: 'e-1',
    event: { title: 'Семинар', currency: 'RUB' },
    payments: [],
    ...over,
})

const settingsRow = (over: Record<string, unknown> = {}) => ({
    workspaceId: 'w1',
    provider: 'YOOKASSA',
    shopId: '123',
    secretKeyEncrypted: encryptPaymentSecret('live_key_1234', KEY),
    webhookSecretEncrypted: null,
    receiptEnabled: true,
    vatCode: 1,
    paymentSubject: 'service',
    paymentMode: 'full_prepayment',
    ...over,
})

const setup = (opts: {
    sub?: Record<string, unknown> | null
    reg?: Record<string, unknown> | null
    payment?: Record<string, unknown> | null
    settings?: Record<string, unknown> | null
    saleCount?: number
    paymentCount?: number
    regAfter?: { refundedAmount: number; amountPaid: number }
    cancellation?: unknown
    refundError?: Error
} = {}) => {
    const prisma: Record<string, unknown> & Record<string, Record<string, jest.Mock>> = {
        subscription: {
            findFirst: jest.fn().mockResolvedValue(opts.sub === undefined ? subscription() : opts.sub),
            updateMany: jest.fn().mockResolvedValue({ count: opts.saleCount ?? 1 }),
        },
        eventRegistration: {
            findFirst: jest.fn().mockResolvedValue(opts.reg === undefined ? ticket() : opts.reg),
            updateMany: jest.fn().mockResolvedValue({ count: opts.saleCount ?? 1 }),
            findUniqueOrThrow: jest
                .fn()
                .mockResolvedValue(opts.regAfter ?? { refundedAmount: 1500, amountPaid: 1500 }),
        },
        payment: {
            findFirst: jest.fn().mockResolvedValue(opts.payment ?? null),
            updateMany: jest.fn().mockResolvedValue({ count: opts.paymentCount ?? 1 }),
        },
        workspacePaymentSettings: {
            findUnique: jest
                .fn()
                .mockResolvedValue(opts.settings === undefined ? settingsRow() : opts.settings),
        },
        refund: { create: jest.fn().mockResolvedValue({ id: 'ref-1' }) },
        workspace: { findUnique: jest.fn().mockResolvedValue({ name: 'Академия' }) },
    }
    prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)) as never
    prisma.$executeRaw = jest.fn().mockResolvedValue(1) as never
    prisma.$queryRaw = jest.fn().mockResolvedValue([{ '?column?': 1 }]) as never
    const gateway = {
        refund: opts.refundError
            ? jest.fn().mockRejectedValue(opts.refundError)
            : jest.fn().mockResolvedValue(undefined),
    }
    const eventRegistrations = {
        lockEventInTx: jest.fn().mockResolvedValue(undefined),
        cancelByClubInTx: jest.fn().mockResolvedValue(opts.cancellation ?? null),
        afterClubCancel: jest.fn(),
    }
    const audit = { record: jest.fn() }
    const notifications = { notifyUser: jest.fn().mockResolvedValue(true) }
    const realtime = { invalidate: jest.fn() }
    const service = new RefundService(
        prisma as never,
        gateway as never,
        eventRegistrations as never,
        audit as never,
        notifications as never,
        realtime as never,
    )
    const run = (
        payload: Partial<CreateRefundFeature['payload']> = {},
        caller: Caller = ADMIN,
    ) =>
        new CreateRefundHandler(prisma as never, rbac() as never, service).execute(
            new CreateRefundFeature(
                {
                    target: 'abonement',
                    targetId: SUB_ID,
                    amount: 1000,
                    method: 'CASH',
                    reason: 'Пропустил две недели',
                    ...payload,
                },
                'w1',
                caller.userId,
                caller.roleName,
                false,
            ),
        )
    return { prisma, gateway, eventRegistrations, audit, notifications, realtime, run }
}

const detail = (id: string) => ({
    id,
    refunds: [{ id: 'ref:ref-1', kind: 'refund', amount: 1000 }],
})

beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] })
    ;(loadPaymentJournalDetail as jest.Mock).mockImplementation(
        async (_p: unknown, _w: string, id: string) => detail(id),
    )
})
afterEach(() => jest.useRealTimers())

describe('createRefund', () => {
    it.each([
        ['a head coach', { userId: 'hc-1', roleName: 'head_coach' }],
        ['a coach', { userId: 'c-1', roleName: 'coach' }],
        ['a direction manager', { userId: 'dm-1', roleName: 'coach' }],
    ])('refuses %s before reading anything', async (_, caller) => {
        const { prisma, run } = setup()
        await expect(run({}, caller)).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.subscription.findFirst).not.toHaveBeenCalled()
    })

    it('a partial cash refund of an abonement: bounded increment, Refund row, abonement untouched otherwise', async () => {
        const { prisma, gateway, audit, notifications, realtime, run } = setup()
        const out = await run({}, OWNER)

        expect(gateway.refund).not.toHaveBeenCalled()
        expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
            where: { id: SUB_ID, isPaid: true, refundedAmount: { lte: 3000 } },
            data: { refundedAmount: { increment: 1000 } },
        })
        // Never the paid fields, never the status: the abonement stays.
        expect(JSON.stringify(prisma.subscription.updateMany.mock.calls)).not.toMatch(
            /isPaid":false|status|amountPaid|paidAt/,
        )
        expect(prisma.refund.create.mock.calls[0][0].data).toEqual({
            workspaceId: 'w1',
            subscriptionId: SUB_ID,
            eventRegistrationId: null,
            paymentId: null,
            userId: 'u-1',
            itemName: 'Безлимит',
            amount: 1000,
            currency: 'RUB',
            method: 'CASH',
            reason: 'Пропустил две недели',
            createdById: OWNER_ID,
            refundedAt: NOW,
        })
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'payment.refund',
                targetType: 'member',
                targetId: 'u-1',
                actorId: OWNER_ID,
                metadata: expect.objectContaining({
                    refundId: 'ref-1',
                    target: 'abonement',
                    targetId: SUB_ID,
                    amount: 1000,
                    method: 'CASH',
                    reason: 'Пропустил две недели',
                }),
            }),
        )
        expect(notifications.notifyUser).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'u-1',
                kind: 'payment.refunded',
                refId: 'ref-1',
                topic: 'Возврат денег',
                message: 'Клуб «Академия» вернул 1\u00a0000 ₽ за «Безлимит» — наличными',
                metadata: { refundId: 'ref-1', amount: 1000, currency: 'RUB', subscriptionId: SUB_ID },
            }),
        )
        expect(realtime.invalidate).toHaveBeenCalledWith('w1', ['payments', 'members', 'subscription'])
        expect(out).toEqual({ refund: detail(`sub:${SUB_ID}`).refunds[0], sale: detail(`sub:${SUB_ID}`) })
    })

    it('404s on an unpaid or foreign abonement', async () => {
        const { run } = setup({ sub: null })
        await expect(run()).rejects.toBeInstanceOf(NotFoundError)
    })

    it('refuses more than is left to refund, naming the limit', async () => {
        const { prisma, run } = setup({ sub: subscription({ refundedAmount: 3500 }) })
        await expect(run({ amount: 1000 })).rejects.toBeInstanceOf(BadRequestError)
        await expect(run({ amount: 1000 })).rejects.toThrow('Вернуть можно от 1 до 500 ₽')
        expect(prisma.refund.create).not.toHaveBeenCalled()
    })

    it('a lost race on the bounded increment is a 409 and records nothing', async () => {
        const { prisma, notifications, run } = setup({ saleCount: 0 })
        const out = run()
        await expect(out).rejects.toBeInstanceOf(ConflictError)
        await expect(run()).rejects.toThrow(REFUND_CONFLICT)
        expect(prisma.refund.create).not.toHaveBeenCalled()
        expect(notifications.notifyUser).not.toHaveBeenCalled()
    })

    it('ONLINE needs the sale’s online payment', async () => {
        const { gateway, run } = setup()
        await expect(run({ method: 'ONLINE' })).rejects.toThrow(REFUND_NOT_ONLINE)
        expect(gateway.refund).not.toHaveBeenCalled()
    })

    it('ONLINE refuses when the payment’s provider is no longer connected', async () => {
        const { gateway, run } = setup({
            sub: subscription({ payment: online() }),
            settings: settingsRow({ provider: 'STRIPE' }),
        })
        await expect(run({ method: 'ONLINE' })).rejects.toThrow(REFUND_PROVIDER_OFF)
        expect(gateway.refund).not.toHaveBeenCalled()
    })

    it('a partial YooKassa refund sends a receipt to the payment’s receipt e-mail, CAS on the payment', async () => {
        const { prisma, gateway, run } = setup({ sub: subscription({ payment: online() }) })
        await run({ method: 'ONLINE', amount: 1000 })

        expect(gateway.refund).toHaveBeenCalledWith(
            expect.objectContaining({ provider: 'YOOKASSA' }),
            {
                paymentId: PAY_ID,
                providerPaymentId: 'yk-1',
                amount: 1000,
                currency: 'RUB',
                idempotenceKey: `refund-${PAY_ID}-0-1000`,
                receipt: { customerEmail: 'buyer@x.ru', itemName: 'Безлимит' },
            },
        )
        expect(prisma.payment.updateMany).toHaveBeenCalledWith({
            where: { id: PAY_ID, status: 'SUCCEEDED', refundedAmount: 0 },
            data: { refundedAmount: 1000, status: 'SUCCEEDED', refundedAt: NOW },
        })
        expect(prisma.refund.create.mock.calls[0][0].data).toMatchObject({
            paymentId: PAY_ID,
            method: 'ONLINE',
        })
    })

    it('a partial refund of a payment from before receiptEmail falls back to the payer’s e-mail', async () => {
        const { gateway, run } = setup({
            sub: subscription({ payment: online({ receiptEmail: null }) }),
        })
        await run({ method: 'ONLINE', amount: 1000 })
        expect(gateway.refund.mock.calls[0][1].receipt).toEqual({
            customerEmail: 'current@x.ru',
            itemName: 'Безлимит',
        })
    })

    it('a partial YooKassa refund with no e-mail at all is refused before the provider call', async () => {
        const { gateway, run } = setup({
            sub: subscription({ payment: online({ receiptEmail: null, user: { email: null } }) }),
        })
        await expect(run({ method: 'ONLINE', amount: 1000 })).rejects.toThrow(
            REFUND_NEEDS_RECEIPT_EMAIL,
        )
        expect(gateway.refund).not.toHaveBeenCalled()
    })

    it('the rest of a partially refunded payment: no receipt needed only for the whole amount; REFUNDED when it reaches it', async () => {
        const { prisma, gateway, run } = setup({
            sub: subscription({ refundedAmount: 1000, payment: online({ refundedAmount: 1000 }) }),
        })
        await run({ method: 'ONLINE', amount: 3000 })
        // 3000 < 4000: still a partial refund for the receipt.
        expect(gateway.refund.mock.calls[0][1]).toMatchObject({
            idempotenceKey: `refund-${PAY_ID}-1000-3000`,
            receipt: { customerEmail: 'buyer@x.ru' },
        })
        expect(prisma.payment.updateMany.mock.calls[0][0]).toEqual({
            where: { id: PAY_ID, status: 'SUCCEEDED', refundedAmount: 1000 },
            data: { refundedAmount: 4000, status: 'REFUNDED', refundedAt: NOW },
        })
    })

    it('a full YooKassa refund reuses the payment’s receipt (none sent)', async () => {
        const { gateway, run } = setup({ sub: subscription({ payment: online() }) })
        await run({ method: 'ONLINE', amount: 4000 })
        expect(gateway.refund.mock.calls[0][1].receipt).toBeUndefined()
    })

    it('Stripe gets the amount and never a receipt', async () => {
        const { gateway, run } = setup({
            sub: subscription({ payment: online({ provider: 'STRIPE', providerPaymentId: 'cs_1' }) }),
            settings: settingsRow({ provider: 'STRIPE', shopId: null }),
        })
        await run({ method: 'ONLINE', amount: 1000 })
        expect(gateway.refund).toHaveBeenCalledWith(
            expect.objectContaining({ provider: 'STRIPE' }),
            expect.objectContaining({ amount: 1000, providerPaymentId: 'cs_1' }),
        )
        expect(gateway.refund.mock.calls[0][1].receipt).toBeUndefined()
    })

    it('a provider refusal surfaces and writes nothing', async () => {
        const { prisma, run } = setup({
            sub: subscription({ payment: online() }),
            refundError: new PaymentGatewayError('YOOKASSA POST /refunds answered 400', 400, 'Нельзя'),
        })
        await expect(run({ method: 'ONLINE' })).rejects.toThrow(
            'Платёжная система не провела возврат: Нельзя',
        )
        expect(prisma.subscription.updateMany).not.toHaveBeenCalled()
        expect(prisma.refund.create).not.toHaveBeenCalled()
    })

    it('online refunds of one payment are serialized: advisory lock on the payment, the abonement row locked, generous transaction timeout', async () => {
        const { prisma, run } = setup({ sub: subscription({ payment: online() }) })
        await run({ method: 'ONLINE', amount: 1000 })
        const advisory = (prisma.$executeRaw as unknown as jest.Mock).mock.calls[0]
        expect(advisory[0].join('?')).toContain('pg_advisory_xact_lock(hashtext(?))')
        expect(advisory[1]).toBe(PAY_ID)
        const rowLock = (prisma.$queryRaw as unknown as jest.Mock).mock.calls[0]
        expect(rowLock[0].join('?')).toContain('FOR UPDATE')
        expect(rowLock[1]).toBe(SUB_ID)
        expect((prisma.$transaction as unknown as jest.Mock).mock.calls[0][1]).toMatchObject({ timeout: 45_000 })
        // The target is re-read under the locks.
        expect(prisma.subscription.findFirst).toHaveBeenCalledTimes(2)
    })

    it('a double submit: the second request finds the payment moved under the lock → 409 before the provider', async () => {
        const { prisma, gateway, run } = setup()
        // What the admin's request read, then what it finds once the first
        // request has committed.
        prisma.subscription.findFirst
            .mockResolvedValueOnce(subscription({ payment: online() }))
            .mockResolvedValueOnce(subscription({ refundedAmount: 1000, payment: online({ refundedAmount: 1000 }) }))
        await expect(run({ method: 'ONLINE', amount: 1000 })).rejects.toThrow(REFUND_CONFLICT)
        expect(gateway.refund).not.toHaveBeenCalled()
        expect(prisma.refund.create).not.toHaveBeenCalled()
    })

    it('the record failing after the provider refunded: logged with the keys, a distinct message', async () => {
        const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
        const { prisma, gateway, notifications, run } = setup({
            sub: subscription({ payment: online() }),
            paymentCount: 0,
        })
        const out = run({ method: 'ONLINE', amount: 1000 })
        await expect(out).rejects.toBeInstanceOf(ConflictError)
        await expect(out).rejects.toThrow(REFUND_NEEDS_RECONCILIATION)
        expect(gateway.refund).toHaveBeenCalledTimes(1)
        expect(prisma.refund.create).not.toHaveBeenCalled()
        expect(notifications.notifyUser).not.toHaveBeenCalled()
        const logged = String(error.mock.calls[0][0])
        expect(logged).toContain(PAY_ID)
        expect(logged).toContain('yk-1')
        expect(logged).toContain('amount 1000 RUB')
        expect(logged).toContain(`refund-${PAY_ID}-0-1000`)
        error.mockRestore()
    })

    it('cash for an online sale is allowed (money handed back at the desk)', async () => {
        const { gateway, prisma, run } = setup({ sub: subscription({ payment: online() }) })
        await run({ method: 'CASH', amount: 500 })
        expect(gateway.refund).not.toHaveBeenCalled()
        expect(prisma.payment.updateMany).not.toHaveBeenCalled()
    })

    describe('tickets', () => {
        const cancellation = { event: { workspaceId: 'w1' }, promoted: [], registrationId: REG_ID, userId: 'u-2' }

        it('a full refund of an upcoming ticket cancels it under the event lock and says so', async () => {
            const { eventRegistrations, notifications, audit, realtime, run } = setup({ cancellation })
            await run({ target: 'ticket', targetId: REG_ID, amount: 1500 })

            expect(eventRegistrations.lockEventInTx).toHaveBeenCalledWith(expect.anything(), 'e-1')
            expect(eventRegistrations.cancelByClubInTx).toHaveBeenCalledWith(expect.anything(), {
                registrationId: REG_ID,
                now: NOW,
            })
            expect(eventRegistrations.afterClubCancel).toHaveBeenCalledWith(cancellation)
            expect(audit.record.mock.calls[0][0].metadata.registrationCancelled).toBe(true)
            expect(notifications.notifyUser.mock.calls[0][0]).toMatchObject({
                message: 'Клуб «Академия» отменил вашу запись на «Семинар» и вернул 1\u00a0500 ₽ — наличными',
                metadata: { eventRegistrationId: REG_ID, eventId: 'e-1' },
            })
            expect(realtime.invalidate).toHaveBeenCalledWith('w1', ['payments', 'events', 'eventregistrations'])
        })

        it('a partial refund keeps the place', async () => {
            const { eventRegistrations, run } = setup({ regAfter: { refundedAmount: 500, amountPaid: 1500 } })
            await run({ target: 'ticket', targetId: REG_ID, amount: 500 })
            expect(eventRegistrations.cancelByClubInTx).not.toHaveBeenCalled()
        })

        it('a full refund after the start keeps the place (the service declines)', async () => {
            const { eventRegistrations, audit, run } = setup({ cancellation: null })
            await run({ target: 'ticket', targetId: REG_ID, amount: 1500 })
            expect(eventRegistrations.cancelByClubInTx).toHaveBeenCalled()
            expect(eventRegistrations.afterClubCancel).not.toHaveBeenCalled()
            expect(audit.record.mock.calls[0][0].metadata.registrationCancelled).toBeUndefined()
        })

        it('ONLINE uses the payment that marked the ticket paid', async () => {
            const { gateway, run } = setup({
                reg: ticket({ paymentMethod: 'ONLINE', payments: [online({ amount: 1500 })] }),
            })
            await run({ target: 'ticket', targetId: REG_ID, amount: 1500, method: 'ONLINE' })
            expect(gateway.refund.mock.calls[0][1]).toMatchObject({ paymentId: PAY_ID, amount: 1500 })
        })
    })

    describe('unapplied online payments', () => {
        const unapplied = () => ({
            ...online({ activationError: 'Абонемент уже продан' }),
            userId: 'u-3',
            planName: 'Безлимит',
        })

        it('refuses an offline method', async () => {
            const { run } = setup({ payment: unapplied() })
            await expect(
                run({ target: 'unapplied', targetId: PAY_ID, method: 'CASH' }),
            ).rejects.toThrow(REFUND_UNAPPLIED_ONLINE_ONLY)
        })

        it('404s on a payment that is not unapplied', async () => {
            const { run } = setup({ payment: { ...unapplied(), activationError: null } })
            await expect(
                run({ target: 'unapplied', targetId: PAY_ID, method: 'ONLINE' }),
            ).rejects.toBeInstanceOf(NotFoundError)
        })

        it('refunds through the provider with no sale to touch and no journal sale in the answer', async () => {
            const { prisma, gateway, run } = setup({ payment: unapplied() })
            ;(prisma.refund as Record<string, jest.Mock>).findUniqueOrThrow = jest.fn().mockResolvedValue({
                id: 'ref-1',
                refundedAt: NOW,
                amount: 4000,
                currency: 'RUB',
                method: 'ONLINE',
                reason: 'Пропустил две недели',
                createdById: 'a-1',
                userId: 'u-3',
                itemName: 'Безлимит',
                user: { firstname: 'Ольга', lastname: null, email: null },
                subscription: null,
                eventRegistration: null,
                payment: { id: PAY_ID, provider: 'YOOKASSA', providerPaymentId: 'yk-1', status: 'REFUNDED', amount: 4000, refundedAmount: 4000 },
            })
            prisma.payment.findUnique = jest.fn().mockResolvedValue({ eventRegistrationId: null })
            prisma.user = { findMany: jest.fn().mockResolvedValue([]) }
            prisma.workspaceMember = { findMany: jest.fn().mockResolvedValue([]) }

            const out = await run({ target: 'unapplied', targetId: PAY_ID, method: 'ONLINE', amount: 4000 })

            expect(gateway.refund).toHaveBeenCalled()
            expect(prisma.subscription.updateMany).not.toHaveBeenCalled()
            expect(prisma.eventRegistration.updateMany).not.toHaveBeenCalled()
            expect(prisma.refund.create.mock.calls[0][0].data).toMatchObject({
                subscriptionId: null,
                eventRegistrationId: null,
                paymentId: PAY_ID,
                userId: 'u-3',
            })
            expect(out.sale).toBeNull()
            expect(out.refund).toMatchObject({ id: 'ref:ref-1', kind: 'refund', source: 'abonement', amount: 4000 })
        })
    })
})
