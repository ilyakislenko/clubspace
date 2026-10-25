import { BadRequestError, ForbiddenError } from '../../shared/errors/shared.errors'
import { RecordRankGradingResultsFeature } from './record-rank-grading-results.feature'
import { RecordRankGradingResultsHandler } from './record-rank-grading-results.handler'

const GRADING_ROW = {
    id: 'gr1',
    ladderId: 'l1',
    ladder: { name: 'Взрослые' },
    title: 'Аттестация · Взрослые',
    date: new Date('2026-11-15T00:00:00Z'),
    gym: null,
    feeAmount: null,
    feeCurrency: null,
    candidates: [],
    createdAt: new Date('2026-10-01T00:00:00Z'),
}

const cand = (id: string, over: object = {}) => ({
    id,
    userId: `user-${id}`,
    levelId: 'blue',
    stripes: 0,
    result: 'PENDING',
    user: { firstname: id, lastname: null },
    ...over,
})

const make = (
    o: {
        candidates?: object[]
        claim?: number
        admin?: boolean
        grading?: object | null
        members?: string[]
        latest?: object[]
    } = {},
) => {
    const calls: string[] = []
    const tx = {
        rankGradingCandidate: {
            updateMany: jest.fn().mockImplementation(() => {
                calls.push('claim')
                return Promise.resolve({ count: o.claim ?? 1 })
            }),
            update: jest.fn().mockImplementation(() => {
                calls.push('link')
                return Promise.resolve({})
            }),
        },
    }
    const prisma = {
        rankGrading: {
            findFirst: jest.fn().mockImplementation(({ include }) =>
                Promise.resolve(
                    include
                        ? GRADING_ROW
                        : o.grading === undefined
                          ? { id: 'gr1', title: 'Аттестация · Взрослые', date: GRADING_ROW.date, ladderId: 'l1' }
                          : o.grading,
                ),
            ),
        },
        rankGradingCandidate: {
            findMany: jest.fn().mockResolvedValue(o.candidates ?? [cand('c1')]),
        },
        workspaceMember: {
            findMany: jest.fn().mockImplementation(() =>
                Promise.resolve(
                    (
                        o.members ??
                        (o.candidates ?? [cand('c1')]).map(
                            (c) => (c as { userId: string }).userId,
                        )
                    ).map((userId) => ({ userId })),
                ),
            ),
        },
        rankPromotion: { findMany: jest.fn().mockResolvedValue(o.latest ?? []) },
        rankLevel: {
            findMany: jest.fn().mockResolvedValue([{ id: 'blue', order: 1 }]),
        },
        $transaction: jest.fn().mockImplementation((fn) => fn(tx)),
    }
    const rbac = {
        resolveCoachScope: jest.fn().mockResolvedValue({
            scope: o.admin === false ? 'coach_own_only' : 'admin',
            workspaceOwnerId: 'owner1',
        }),
        canWriteAllGroups: jest.fn().mockReturnValue(o.admin !== false),
    }
    const ranks = {
        promoteInTx: jest.fn().mockImplementation((_tx, p) => {
            calls.push('promote')
            return Promise.resolve({
                id: `promo-${p.userId}`,
                userId: p.userId,
                ladderId: p.ladderId,
                levelId: p.levelId,
                stripes: p.stripes,
                level: { name: 'Синий' },
                ladder: { name: 'Взрослые' },
            })
        }),
    }
    const notifications = { notifyUser: jest.fn().mockResolvedValue(true) }
    const realtime = { invalidate: jest.fn() }
    const handler = new RecordRankGradingResultsHandler(
        prisma as never,
        rbac as never,
        ranks as never,
        notifications as never,
        realtime as never,
    )
    const run = (results: { candidateId: string; result: string }[], invoker = 'examiner') =>
        handler.execute(
            new RecordRankGradingResultsFeature({ results } as never, 'w1', 'gr1', invoker, 'admin', false),
        )
    return { prisma, tx, ranks, notifications, realtime, rbac, calls, run }
}

describe('recordRankGradingResults', () => {
    it('rejects coach scope before reading anything', async () => {
        const { prisma, run } = make({ admin: false })
        await expect(run([{ candidateId: 'c1', result: 'PASSED' }])).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        expect(prisma.rankGrading.findFirst).not.toHaveBeenCalled()
    })

    it('404s a missing grading and a candidate from elsewhere', async () => {
        await expect(
            make({ grading: null }).run([{ candidateId: 'c1', result: 'PASSED' }]),
        ).rejects.toThrow(/Аттестация не найдена/)
        await expect(
            make({ candidates: [] }).run([{ candidateId: 'c1', result: 'PASSED' }]),
        ).rejects.toThrow(/Кандидат не найден/)
    })

    it('claims, promotes on the tx and links, in that order, awarded by the examiner', async () => {
        const { calls, ranks, tx, run, prisma, realtime } = make()
        const out = await run([{ candidateId: 'c1', result: 'PASSED' }])
        expect(calls).toEqual(['claim', 'promote', 'link'])
        expect(ranks.promoteInTx.mock.calls[0][0]).toBe(tx)
        expect(ranks.promoteInTx.mock.calls[0][1]).toMatchObject({
            workspaceId: 'w1',
            userId: 'user-c1',
            ladderId: 'l1',
            levelId: 'blue',
            awardedById: 'examiner',
            note: 'Аттестация · Взрослые · 15 ноября',
        })
        expect(tx.rankGradingCandidate.updateMany.mock.calls[0][0]).toMatchObject({
            where: { id: 'c1', result: { not: 'PASSED' } },
            data: { result: 'PASSED' },
        })
        expect(tx.rankGradingCandidate.update.mock.calls[0][0]).toEqual({
            where: { id: 'c1' },
            data: { promotionId: 'promo-user-c1' },
        })
        expect(prisma.$transaction.mock.calls[0][1]).toEqual({ timeout: 30000 })
        expect(realtime.invalidate).toHaveBeenCalledWith('w1', ['ranks'])
        expect(out.promoted).toBe(1)
        expect(out.grading.id).toBe('gr1')
    })

    it('skips the promotion when a concurrent request already claimed it', async () => {
        const { ranks, notifications, run } = make({ claim: 0 })
        const out = await run([{ candidateId: 'c1', result: 'PASSED' }])
        expect(ranks.promoteInTx).not.toHaveBeenCalled()
        expect(notifications.notifyUser).not.toHaveBeenCalled()
        expect(out.promoted).toBe(0)
    })

    it('treats PASSED on an already PASSED candidate as a no-op', async () => {
        const { prisma, ranks, run } = make({ candidates: [cand('c1', { result: 'PASSED' })] })
        const out = await run([{ candidateId: 'c1', result: 'PASSED' }])
        expect(ranks.promoteInTx).not.toHaveBeenCalled()
        expect(out.promoted).toBe(0)
        expect(prisma.$transaction).toHaveBeenCalled()
    })

    it('refuses to change a PASSED result, naming the member', async () => {
        const { prisma, run } = make({ candidates: [cand('Иван', { result: 'PASSED', user: { firstname: 'Иван', lastname: null } })] })
        await expect(run([{ candidateId: 'Иван', result: 'FAILED' }])).rejects.toThrow(
            /«сдал» у Иван уже записан/,
        )
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('records FAILED with a timestamp and PENDING by clearing it', async () => {
        const { tx, ranks, run } = make({ candidates: [cand('c1'), cand('c2', { result: 'FAILED' })] })
        await run([
            { candidateId: 'c1', result: 'FAILED' },
            { candidateId: 'c2', result: 'PENDING' },
        ])
        const writes = tx.rankGradingCandidate.updateMany.mock.calls.map((c) => c[0])
        expect(writes[0]).toMatchObject({ where: { id: 'c1', result: { not: 'PASSED' } }, data: { result: 'FAILED' } })
        expect(writes[0].data.resultAt).toBeInstanceOf(Date)
        expect(writes[1].data).toEqual({ result: 'PENDING', resultAt: null })
        expect(ranks.promoteInTx).not.toHaveBeenCalled()
    })

    it('lets the last entry win for a repeated candidate', async () => {
        const { ranks, prisma, run } = make()
        await run([
            { candidateId: 'c1', result: 'PASSED' },
            { candidateId: 'c1', result: 'FAILED' },
        ])
        expect(ranks.promoteInTx).not.toHaveBeenCalled()
        expect(prisma.rankGradingCandidate.findMany.mock.calls[0][0].where.id.in).toEqual(['c1'])
    })

    it('refuses people who left the club, naming them, before any write', async () => {
        const { prisma, ranks, run } = make({
            candidates: [cand('Иван', { user: { firstname: 'Иван', lastname: null } })],
            members: [],
        })
        await expect(run([{ candidateId: 'Иван', result: 'PASSED' }])).rejects.toThrow(
            /Не в клубе: Иван/,
        )
        expect(prisma.$transaction).not.toHaveBeenCalled()
        expect(ranks.promoteInTx).not.toHaveBeenCalled()
    })

    it('lets the owner pass without a member row', async () => {
        const { ranks, run } = make({
            candidates: [cand('c1', { userId: 'owner1' })],
            members: [],
        })
        const out = await run([{ candidateId: 'c1', result: 'PASSED' }])
        expect(out.promoted).toBe(1)
        expect(ranks.promoteInTx).toHaveBeenCalled()
    })

    it('refuses a candidate who already holds an equal or higher rank', async () => {
        const { prisma, run } = make({
            candidates: [cand('Анна', { user: { firstname: 'Анна', lastname: null } })],
            latest: [{ userId: 'user-Анна', stripes: 0, level: { order: 2 } }],
        })
        await expect(run([{ candidateId: 'Анна', result: 'PASSED' }])).rejects.toThrow(
            /Уже имеют этот или более высокий ранг: Анна/,
        )
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('refuses the same level with the same or more stripes but allows more stripes', async () => {
        const held = { userId: 'user-c1', stripes: 2, level: { order: 1 } }
        const same = make({ candidates: [cand('c1', { stripes: 2 })], latest: [held] })
        await expect(same.run([{ candidateId: 'c1', result: 'PASSED' }])).rejects.toThrow(
            /Уже имеют/,
        )
        const more = make({ candidates: [cand('c1', { stripes: 3 })], latest: [held] })
        expect((await more.run([{ candidateId: 'c1', result: 'PASSED' }])).promoted).toBe(1)
    })

    it('names the candidate when a promotion in the batch fails', async () => {
        const { ranks, run } = make({
            candidates: [cand('Пётр', { user: { firstname: 'Пётр', lastname: null } })],
        })
        ranks.promoteInTx.mockRejectedValue(
            new BadRequestError({ message: 'Полосок может быть от 0 до 2' }),
        )
        await expect(run([{ candidateId: 'Пётр', result: 'PASSED' }])).rejects.toThrow(
            /Пётр: Полосок может быть от 0 до 2/,
        )
    })

    it('does not throw when a congratulation push fails', async () => {
        const { notifications, run } = make()
        notifications.notifyUser.mockRejectedValue(new Error('push down'))
        const out = await run([{ candidateId: 'c1', result: 'PASSED' }])
        expect(out.promoted).toBe(1)
    })

    it('does not congratulate the examiner on their own promotion', async () => {
        const { notifications, run } = make({
            candidates: [cand('c1', { userId: 'examiner' }), cand('c2')],
        })
        await run([
            { candidateId: 'c1', result: 'PASSED' },
            { candidateId: 'c2', result: 'PASSED' },
        ])
        expect(notifications.notifyUser).toHaveBeenCalledTimes(1)
        expect(notifications.notifyUser.mock.calls[0][0]).toMatchObject({
            userId: 'user-c2',
            kind: 'rank.promoted',
        })
    })
})
