import { BadRequestError, ForbiddenError } from '../../shared/errors/shared.errors'
import { ConfirmBankStatementFeature } from './bank-statements.feature'
import { ConfirmBankStatementHandler } from './confirm-bank-statement.handler'

const OWNER_ID = 'owner-1'
const W = 'w1'
const SUB_A = '0d4e8f1a-2b3c-4d5e-8f90-a1b2c3d4e5f6'
const SUB_B = '1e5f9a2b-3c4d-4e6f-9a01-b2c3d4e5f6a7'
const FP_A = 'a'.repeat(64)
const FP_B = 'b'.repeat(64)

const rbac = () => ({
    resolveCoachScope: jest.fn(async (p: { userId: string; workspaceId: string; roleName: string | null }) => ({
        scope: p.roleName === 'coach' ? 'coach_own_only' : 'admin',
        userId: p.userId,
        workspaceId: p.workspaceId,
        workspaceOwnerId: OWNER_ID,
    })),
})

const makePrisma = () => {
    const tx = { bankStatementMatch: { create: jest.fn().mockResolvedValue({}) } }
    return {
        tx,
        // A club east of Moscow: bank times stay Moscow time, dates without a time are club-local.
        workspace: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Tomsk' }) },
        subscription: {
            findMany: jest.fn().mockResolvedValue([
                { id: SUB_A, workspaceMember: { userId: 'u-a' } },
                { id: SUB_B, workspaceMember: { userId: 'u-b' } },
            ]),
        },
        $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    }
}

// What markPaidInTx wrote, from what it was asked to write.
const makeSubscriptions = () => ({
    markPaidInTx: jest.fn(
        async (_tx: unknown, p: { subscriptionId: string; amount: number; paymentMethod: string; paidAt: Date }) => ({
            id: p.subscriptionId,
            amountPaid: p.amount,
            currency: 'RUB',
            paymentMethod: p.paymentMethod,
            paidAt: p.paidAt,
            listPrice: 3000,
            discountId: null,
            discountName: null,
            discountAmount: 0,
            plan: { name: 'Безлимит' },
        }),
    ),
})

const setup = () => {
    const prisma = makePrisma()
    const subscriptions = makeSubscriptions()
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const realtime = { invalidate: jest.fn() }
    const handler = new ConfirmBankStatementHandler(
        prisma as never,
        rbac() as never,
        subscriptions as never,
        audit as never,
        realtime as never,
    )
    const run = (
        matches: ConfirmBankStatementFeature['payload']['matches'],
        caller: { userId: string; roleName: string | null } = { userId: 'a-1', roleName: 'admin' },
    ) => handler.execute(new ConfirmBankStatementFeature({ matches }, W, caller.userId, caller.roleName, false))
    return { prisma, subscriptions, audit, realtime, run }
}

const match = (over: Partial<ConfirmBankStatementFeature['payload']['matches'][number]> = {}) => ({
    fingerprint: FP_A,
    subscriptionId: SUB_A,
    amount: 3000,
    paidOn: '2026-11-05',
    paidTime: null,
    ...over,
})

beforeAll(() => {
    jest.useFakeTimers({ now: new Date('2026-11-28T09:00:00Z') })
})
afterAll(() => {
    jest.useRealTimers()
})

describe('ConfirmBankStatementHandler', () => {
    it.each([
        ['a coach', 'coach'],
        ['a head coach', 'head_coach'],
    ])('refuses %s and writes nothing', async (_, roleName) => {
        const s = setup()
        await expect(s.run([match()], { userId: 'c-1', roleName })).rejects.toThrow(ForbiddenError)
        expect(s.prisma.$transaction).not.toHaveBeenCalled()
        expect(s.subscriptions.markPaidInTx).not.toHaveBeenCalled()
    })

    it('marks the abonement paid by transfer on the transfer’s date with the amount received, with its fingerprint', async () => {
        const s = setup()
        const res = await s.run([match({ amount: 2800, paidTime: '14:03' })], { userId: OWNER_ID, roleName: null })

        expect(res).toEqual({
            confirmed: 1,
            results: [{ fingerprint: FP_A, subscriptionId: SUB_A, status: 'CONFIRMED', message: null }],
        })
        // The bank's 14:03 is Moscow time (UTC+3), whatever the club's zone.
        const paidAt = new Date('2026-11-05T11:03:00Z')
        expect(s.prisma.tx.bankStatementMatch.create).toHaveBeenCalledWith({
            data: {
                workspaceId: W,
                fingerprint: FP_A,
                subscriptionId: SUB_A,
                amount: 2800,
                paidOn: paidAt,
                transferDay: '2026-11-05',
                matchedById: OWNER_ID,
            },
        })
        expect(s.subscriptions.markPaidInTx).toHaveBeenCalledWith(s.prisma.tx, {
            workspaceId: W,
            userId: 'u-a',
            subscriptionId: SUB_A,
            amount: 2800,
            paymentMethod: 'TRANSFER',
            markedById: OWNER_ID,
            paidAt,
            now: new Date('2026-11-28T09:00:00Z'),
        })
        expect(s.audit.record).toHaveBeenCalledWith({
            action: 'member.markSubscriptionPaid',
            targetType: 'member',
            targetId: 'u-a',
            workspaceId: W,
            actorId: OWNER_ID,
            metadata: expect.objectContaining({
                subscriptionId: SUB_A,
                amount: 2800,
                method: 'TRANSFER',
                // Less than the price: recorded as a one-off discount, as at the desk.
                oneOff: 200,
                paidOn: '2026-11-05',
                bankStatement: true,
            }),
        })
        expect(s.realtime.invalidate).toHaveBeenCalledWith(W, ['members', 'subscription', 'payments'])
    })

    it('dates a transfer without a time at the club’s midnight', async () => {
        const s = setup()
        await s.run([match()])
        // Midnight in Tomsk (UTC+7).
        expect(s.subscriptions.markPaidInTx.mock.calls[0][1].paidAt).toEqual(new Date('2026-11-04T17:00:00Z'))
    })

    it.each([
        ['a future day', { paidOn: '2026-11-29' }, 'Дата перевода ещё не наступила — проверьте выписку'],
        // Now is 12:00 in Moscow: a 13:00 bank time today is still ahead.
        ['a later time today', { paidOn: '2026-11-28', paidTime: '13:00' }, 'Дата перевода ещё не наступила — проверьте выписку'],
        ['a transfer older than 400 days', { paidOn: '2025-09-01' }, 'Перевод старше 400 дней — отметьте оплату в карточке ученика'],
    ])('fails only the row with %s and marks the rest', async (_, over, message) => {
        const s = setup()
        const res = await s.run([match(over), match({ fingerprint: FP_B, subscriptionId: SUB_B })])
        expect(res.results).toEqual([
            { fingerprint: FP_A, subscriptionId: SUB_A, status: 'FAILED', message },
            { fingerprint: FP_B, subscriptionId: SUB_B, status: 'CONFIRMED', message: null },
        ])
        expect(s.subscriptions.markPaidInTx).toHaveBeenCalledTimes(1)
    })

    it('accepts an earlier bank time today', async () => {
        const s = setup()
        const res = await s.run([match({ paidOn: '2026-11-28', paidTime: '11:59' })])
        expect(res.confirmed).toBe(1)
    })

    it('is idempotent: a transfer confirmed before is reported, not marked again', async () => {
        const s = setup()
        s.prisma.$transaction.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }))
        const res = await s.run([match(), match({ fingerprint: FP_B, subscriptionId: SUB_B })])
        expect(res.results.map((r) => r.status)).toEqual(['ALREADY_MATCHED', 'CONFIRMED'])
        expect(res.confirmed).toBe(1)
        expect(s.audit.record).toHaveBeenCalledTimes(1)
        expect(s.audit.record.mock.calls[0][0].metadata.subscriptionId).toBe(SUB_B)
    })

    it('reports an abonement paid meanwhile and goes on with the rest', async () => {
        const s = setup()
        s.subscriptions.markPaidInTx.mockRejectedValueOnce(
            new BadRequestError({ message: 'Оплата уже отмечена 3 нояб. 2026' }),
        )
        const res = await s.run([match(), match({ fingerprint: FP_B, subscriptionId: SUB_B })])
        expect(res.results).toEqual([
            { fingerprint: FP_A, subscriptionId: SUB_A, status: 'FAILED', message: 'Оплата уже отмечена 3 нояб. 2026' },
            { fingerprint: FP_B, subscriptionId: SUB_B, status: 'CONFIRMED', message: null },
        ])
    })

    it('reports an abonement of another club or without a member as not found', async () => {
        const s = setup()
        s.prisma.subscription.findMany.mockResolvedValue([{ id: SUB_A, workspaceMember: null }])
        const res = await s.run([match()])
        expect(s.prisma.subscription.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: W,
            id: { in: [SUB_A] },
        })
        expect(res.results[0]).toMatchObject({ status: 'FAILED', message: 'Абонемент не найден' })
        expect(s.prisma.$transaction).not.toHaveBeenCalled()
        expect(s.realtime.invalidate).not.toHaveBeenCalled()
    })

    it('rethrows an unexpected error', async () => {
        const s = setup()
        s.prisma.$transaction.mockRejectedValueOnce(new Error('db down'))
        await expect(s.run([match()])).rejects.toThrow('db down')
    })

    it.each([
        ['one abonement twice', [match(), match({ fingerprint: FP_B })], 'Один абонемент выбран для двух переводов'],
        ['one transfer twice', [match(), match({ subscriptionId: SUB_B })], 'Один перевод выбран для двух абонементов'],
    ])('refuses %s', async (_, matches, message) => {
        const s = setup()
        await expect(s.run(matches)).rejects.toThrow(message)
        expect(s.prisma.$transaction).not.toHaveBeenCalled()
    })
})
