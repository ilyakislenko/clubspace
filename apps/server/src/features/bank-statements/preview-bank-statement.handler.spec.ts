import { readFileSync } from 'fs'
import { join } from 'path'

import { ForbiddenError } from '../../shared/errors/shared.errors'
import { PreviewBankStatementFeature } from './bank-statements.feature'
import { PreviewBankStatementHandler, STATEMENT_MAX_CANDIDATES } from './preview-bank-statement.handler'
import { fingerprintTransactions, parseStatement } from './statement-parse'

const OWNER_ID = 'owner-1'
const W = 'w1'
const SUB_IVAN = '0d4e8f1a-2b3c-4d5e-8f90-a1b2c3d4e5f6'
const SUB_ANNA = '1e5f9a2b-3c4d-4e6f-9a01-b2c3d4e5f6a7'
const SUB_DONE = '2f6a0b3c-4d5e-4f70-8b12-c3d4e5f6a7b8'
const U_IVAN = '3a7b1c4d-5e6f-4081-9c23-d4e5f6a7b8c9'
const U_ANNA = '4b8c2d5e-6f70-4192-8d34-e5f6a7b8c9d0'

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, '__fixtures__', name)))

const rbac = () => ({
    resolveCoachScope: jest.fn(async (p: { userId: string; workspaceId: string; roleName: string | null }) => ({
        scope: p.roleName === 'coach' ? 'coach_own_only' : 'admin',
        userId: p.userId,
        workspaceId: p.workspaceId,
        workspaceOwnerId: OWNER_ID,
    })),
})

const awaiting = (id: string, userId: string, first: string, last: string, over: Record<string, unknown> = {}) => ({
    id,
    amountPaid: 3000,
    currency: 'RUB',
    startDate: new Date('2026-11-20T00:00:00Z'),
    createdAt: new Date('2026-11-18T05:00:00Z'),
    plan: { name: 'Безлимит' },
    workspaceMember: {
        userId,
        user: { firstname: first, lastname: last, phone: null, dependentOf: [] },
    },
    ...over,
})

const makePrisma = () => ({
    workspace: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Tomsk' }) },
    bankStatementMatch: { findMany: jest.fn().mockResolvedValue([]) },
    subscription: { findMany: jest.fn().mockResolvedValue([]) },
})

const run = (
    prisma: ReturnType<typeof makePrisma>,
    caller: { userId: string; roleName: string | null },
    bytes = fixture('tbank-operations.csv'),
    payload: PreviewBankStatementFeature['payload'] = {},
) =>
    new PreviewBankStatementHandler(prisma as never, rbac() as never).execute(
        new PreviewBankStatementFeature(payload, { bytes }, W, caller.userId, caller.roleName, false),
    )

describe('PreviewBankStatementHandler', () => {
    it.each([
        ['a coach', 'coach'],
        ['a head coach', 'head_coach'],
    ])('refuses %s before reading the file', async (_, roleName) => {
        const prisma = makePrisma()
        await expect(run(prisma, { userId: 'c-1', roleName })).rejects.toThrow(ForbiddenError)
        expect(prisma.subscription.findMany).not.toHaveBeenCalled()
        expect(prisma.bankStatementMatch.findMany).not.toHaveBeenCalled()
    })

    it('matches the owner’s Т-Банк statement against «Ожидают оплаты» (owner has no member row)', async () => {
        const prisma = makePrisma()
        prisma.subscription.findMany.mockResolvedValue([
            awaiting(SUB_IVAN, U_IVAN, 'Иван', 'Иванов'),
            awaiting(SUB_ANNA, U_ANNA, 'Анна', 'Смирнова', { amountPaid: 2500 }),
        ])
        const res = await run(prisma, { userId: OWNER_ID, roleName: null })

        // Only the club's unpaid, held abonements are candidates.
        const args = prisma.subscription.findMany.mock.calls[0][0]
        expect(args.where.AND[0]).toMatchObject({ workspaceId: W, isPaid: false })
        // Only abonements whose window reaches the statement (25–28 Nov), capped.
        expect(args.where.AND[1]).toEqual({
            OR: [
                { createdAt: { gte: new Date('2026-07-27T00:00:00Z') } },
                { startDate: { gte: new Date('2026-07-27T00:00:00Z') } },
            ],
        })
        expect(args.where.AND[2]).toEqual({
            OR: [
                { createdAt: { lte: new Date('2026-12-29T00:00:00Z') } },
                { startDate: { lte: new Date('2026-12-29T00:00:00Z') } },
            ],
        })
        expect(args.take).toBe(STATEMENT_MAX_CANDIDATES)
        expect(res.directionKnown).toBe(true)
        expect(res.format).toBe('CSV')
        expect(res.skippedDebits).toBe(2)
        expect(res.counts).toEqual({ matched: 1, ambiguous: 2, unmatched: 0, alreadyMatched: 0 })

        const [ivan, anna1, anna2] = res.transactions
        expect(ivan).toMatchObject({
            date: '2026-11-28',
            time: '14:03',
            amount: 3000,
            receivedAmount: 3000,
            payer: 'Иван И.',
            status: 'MATCHED',
            suggestedSubscriptionId: SUB_IVAN,
            matchedTo: null,
        })
        expect(ivan.candidates[0]).toMatchObject({
            subscriptionId: SUB_IVAN,
            userId: U_IVAN,
            memberName: 'Иван Иванов',
            planName: 'Безлимит',
            amount: 3000,
            // Club-local days (Asia/Tomsk, UTC+7).
            startDate: '2026-11-20',
            soldOn: '2026-11-18',
            paidBy: null,
        })
        // Two equal transfers from «Анна С.» can't both pay one abonement.
        expect(anna1.status).toBe('AMBIGUOUS')
        expect(anna1.flags).toContain('SAME_ABONEMENT_TWICE')
        expect(anna2.candidates[0].subscriptionId).toBe(SUB_ANNA)
        expect(anna1.fingerprint).not.toBe(anna2.fingerprint)
    })

    it('shows a transfer confirmed before as already matched and doesn’t offer it again (re-upload)', async () => {
        const prisma = makePrisma()
        const parsed = await parseStatement(fixture('tbank-operations.csv'), null)
        const [ivanFp] = fingerprintTransactions(W, parsed.transactions)
        prisma.bankStatementMatch.findMany.mockResolvedValueOnce([
            {
                fingerprint: ivanFp,
                createdAt: new Date('2026-11-29T03:00:00Z'),
                subscription: {
                    id: SUB_DONE,
                    userId: U_IVAN,
                    plan: { name: 'Безлимит' },
                    user: { firstname: 'Иван', lastname: 'Иванов' },
                },
            },
        ])
        prisma.subscription.findMany.mockResolvedValue([awaiting(SUB_IVAN, U_IVAN, 'Иван', 'Иванов')])
        const res = await run(prisma, { userId: 'a-1', roleName: 'admin' })

        expect(prisma.bankStatementMatch.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: W,
            fingerprint: { in: fingerprintTransactions(W, parsed.transactions) },
        })
        expect(res.transactions[0]).toMatchObject({
            status: 'ALREADY_MATCHED',
            suggestedSubscriptionId: null,
            candidates: [],
            matchedTo: {
                subscriptionId: SUB_DONE,
                userId: U_IVAN,
                memberName: 'Иван Иванов',
                planName: 'Безлимит',
                matchedAt: '2026-11-29T03:00:00.000Z',
            },
        })
        expect(res.counts.alreadyMatched).toBe(1)
    })

    it('holds back a transfer whose day and amount were confirmed from another export', async () => {
        const prisma = makePrisma()
        // The exact fingerprints: none (a 1C export of the same day had no time).
        prisma.bankStatementMatch.findMany.mockResolvedValueOnce([])
        prisma.bankStatementMatch.findMany.mockResolvedValueOnce([
            { transferDay: '2026-11-28', amount: 3000, fingerprint: 'f'.repeat(64) },
        ])
        prisma.subscription.findMany.mockResolvedValue([awaiting(SUB_IVAN, U_IVAN, 'Иван', 'Иванов')])
        const res = await run(prisma, { userId: 'a-1', roleName: 'admin' })

        expect(prisma.bankStatementMatch.findMany.mock.calls[1][0]).toEqual({
            where: { workspaceId: W, transferDay: { in: ['2026-11-25', '2026-11-28'] } },
            select: { transferDay: true, amount: true, fingerprint: true },
        })
        expect(res.transactions[0]).toMatchObject({
            status: 'AMBIGUOUS',
            suggestedSubscriptionId: null,
            flags: ['MAYBE_ALREADY_MATCHED'],
        })
        expect(res.transactions[0].candidates[0].subscriptionId).toBe(SUB_IVAN)
    })

    it('doesn’t flag the rest of a day partly confirmed from this same file', async () => {
        const prisma = makePrisma()
        const parsed = await parseStatement(fixture('tbank-operations.csv'), null)
        // Two transfers of 2 500 from «Анна С.» on 25 Nov; the first was confirmed.
        const annaFirst = fingerprintTransactions(W, parsed.transactions)[1]
        prisma.bankStatementMatch.findMany.mockResolvedValueOnce([
            {
                fingerprint: annaFirst,
                createdAt: new Date('2026-11-26T03:00:00Z'),
                subscription: {
                    id: SUB_DONE,
                    userId: U_ANNA,
                    plan: { name: 'Безлимит' },
                    user: { firstname: 'Анна', lastname: 'Смирнова' },
                },
            },
        ])
        prisma.bankStatementMatch.findMany.mockResolvedValueOnce([
            { transferDay: '2026-11-25', amount: 2500, fingerprint: annaFirst },
        ])
        prisma.subscription.findMany.mockResolvedValue([
            awaiting(SUB_ANNA, U_ANNA, 'Анна', 'Смирнова', { amountPaid: 2500 }),
        ])
        const res = await run(prisma, { userId: 'a-1', roleName: 'admin' })
        expect(res.transactions[1].status).toBe('ALREADY_MATCHED')
        expect(res.transactions[2]).toMatchObject({ status: 'MATCHED', suggestedSubscriptionId: SUB_ANNA, flags: [] })
    })

    it('pre-selects nothing when the file doesn’t tell incoming from outgoing', async () => {
        const prisma = makePrisma()
        prisma.subscription.findMany.mockResolvedValue([awaiting(SUB_IVAN, U_IVAN, 'Иван', 'Иванов')])
        const unsigned = new Uint8Array(
            Buffer.from('Дата;Сумма;Плательщик\r\n28.11.2026;3000;Иванов Иван\r\n', 'utf8'),
        )
        const res = await run(prisma, { userId: 'a-1', roleName: 'admin' }, unsigned)
        expect(res.directionKnown).toBe(false)
        expect(res.transactions[0]).toMatchObject({ status: 'AMBIGUOUS', suggestedSubscriptionId: null })
        expect(res.transactions[0].candidates[0].subscriptionId).toBe(SUB_IVAN)
        expect(res.counts.matched).toBe(0)
    })

    it('names the parent who paid for a child (1C file)', async () => {
        const prisma = makePrisma()
        prisma.subscription.findMany.mockResolvedValue([
            awaiting(SUB_IVAN, U_IVAN, 'Михаил', 'Петров', {
                amountPaid: 4500,
                startDate: new Date('2026-11-01T00:00:00Z'),
                createdAt: new Date('2026-10-30T05:00:00Z'),
                workspaceMember: {
                    userId: U_IVAN,
                    user: {
                        firstname: 'Михаил',
                        lastname: 'Петров',
                        phone: null,
                        dependentOf: [
                            {
                                relation: 'PARENT',
                                consentAt: new Date(),
                                guardian: { id: 'g1', firstname: 'Елена', lastname: 'Петрова', email: null, phone: null },
                            },
                        ],
                    },
                },
            }),
        ])
        const res = await run(prisma, { userId: 'a-1', roleName: 'admin' }, fixture('1c-statement-1251.txt'))
        expect(res.format).toBe('ONE_C')
        expect(res.columns).toBeNull()
        expect(res.transactions[0]).toMatchObject({
            payer: 'ПЕТРОВА ЕЛЕНА СЕРГЕЕВНА',
            status: 'MATCHED',
            suggestedSubscriptionId: SUB_IVAN,
        })
        expect(res.transactions[0].candidates[0].paidBy).toBe('Елена Петрова')
        expect(res.transactions[3].status).toBe('UNMATCHED')
    })

    it('returns the headers to pick from when the columns aren’t recognised, and reads with the picked ones', async () => {
        const prisma = makePrisma()
        const first = await run(prisma, { userId: 'a-1', roleName: 'admin' }, fixture('unknown-columns.csv'))
        expect(first.transactions).toEqual([])
        expect(first.columns).toMatchObject({ complete: false, headers: ['Когда', 'Сколько', 'Кто', 'Зачем'] })
        expect(prisma.subscription.findMany).not.toHaveBeenCalled()

        const second = await run(prisma, { userId: 'a-1', roleName: 'admin' }, fixture('unknown-columns.csv'), {
            dateColumn: 0,
            amountColumn: 1,
            payerColumn: 2,
            purposeColumn: 3,
        })
        expect(second.columns).toMatchObject({ complete: true, date: 0, amount: 1, payer: 2, purpose: 3 })
        expect(second.transactions.map((t) => t.payer)).toEqual(['Иван И.', 'Анна С.'])
    })

    it('says so when the club is gone', async () => {
        const prisma = makePrisma()
        prisma.workspace.findUnique.mockResolvedValue(null)
        await expect(run(prisma, { userId: 'a-1', roleName: 'admin' })).rejects.toThrow('Клуб не найден')
    })
})
