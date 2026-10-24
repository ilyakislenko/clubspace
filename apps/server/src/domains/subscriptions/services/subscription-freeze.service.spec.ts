import {
    releaseOpenFreezesInTx,
    SubscriptionFreezeService,
} from './subscription-freeze.service'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-10-24T10:00:00Z')
const END = new Date('2026-11-30T00:00:00Z')

const makeTx = () => ({
    subscription: {
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    workspaceMember: { update: jest.fn().mockResolvedValue({}) },
    subscriptionFreeze: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest
            .fn()
            .mockImplementation(({ data }) => ({ id: 'f1', ...data })),
        update: jest
            .fn()
            .mockImplementation(({ where, data }) => ({ id: where.id, ...data })),
        delete: jest.fn().mockResolvedValue({}),
    },
})
const makePrisma = (tx: ReturnType<typeof makeTx>) => ({
    $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
})
const svcWith = (tx: ReturnType<typeof makeTx>) =>
    new SubscriptionFreezeService(makePrisma(tx) as never)

const subRow = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    status: 'ACTIVE',
    startDate: new Date('2026-10-01T00:00:00Z'),
    endDate: END,
    workspace: { timezone: 'Europe/Moscow' },
    workspaceMember: {
        id: 'm1',
        userId: 'u1',
        subscriptionId: 's1',
        accessUntil: END,
    },
    ...over,
})

const params = (over: Record<string, unknown> = {}) => ({
    workspaceId: 'w1',
    userId: 'u1',
    subscriptionId: 's1',
    days: 7,
    now: NOW,
    ...over,
})

describe('SubscriptionFreezeService.create', () => {
    const setup = (sub = subRow()) => {
        const tx = makeTx()
        tx.subscription.findFirst.mockResolvedValue(sub)
        tx.subscription.findUniqueOrThrow.mockResolvedValue({
            id: 's1',
            plan: { name: 'Monthly' },
        })
        return tx
    }

    it('moves endDate by exactly days x 24h with a compare-and-set on the old value', async () => {
        const tx = setup()
        await svcWith(tx).create(params())
        expect(tx.subscription.updateMany).toHaveBeenCalledWith({
            where: { id: 's1', status: 'ACTIVE', endDate: END },
            data: { endDate: new Date(END.getTime() + 7 * DAY) },
        })
    })

    it('shifts accessUntil when it equals the abonement end', async () => {
        const tx = setup()
        const res = await svcWith(tx).create(params())
        const moved = new Date(END.getTime() + 7 * DAY)
        expect(tx.workspaceMember.update).toHaveBeenCalledWith({
            where: { id: 'm1' },
            data: { accessUntil: moved },
        })
        expect(res.accessUntil).toEqual(moved)
        expect(tx.subscriptionFreeze.create.mock.calls[0][0].data.accessShifted).toBe(
            true,
        )
    })

    it('shifts accessUntil when it runs past the abonement end', async () => {
        const later = new Date('2026-12-31T00:00:00Z')
        const tx = setup(
            subRow({
                workspaceMember: {
                    id: 'm1',
                    userId: 'u1',
                    subscriptionId: 's1',
                    accessUntil: later,
                },
            }),
        )
        await svcWith(tx).create(params())
        expect(tx.workspaceMember.update.mock.calls[0][0].data.accessUntil).toEqual(
            new Date(later.getTime() + 7 * DAY),
        )
    })

    it.each([
        ['unlimited', null],
        ['shorter than the abonement', new Date('2026-11-10T00:00:00Z')],
    ])('leaves accessUntil alone when it is %s', async (_label, accessUntil) => {
        const tx = setup(
            subRow({
                workspaceMember: {
                    id: 'm1',
                    userId: 'u1',
                    subscriptionId: 's1',
                    accessUntil,
                },
            }),
        )
        const res = await svcWith(tx).create(params())
        expect(tx.workspaceMember.update).not.toHaveBeenCalled()
        expect(res.accessUntil).toEqual(accessUntil)
        expect(tx.subscriptionFreeze.create.mock.calls[0][0].data.accessShifted).toBe(
            false,
        )
    })

    it('defaults fromDate to today in the club timezone and ends days - 1 later', async () => {
        const tx = setup()
        await svcWith(tx).create(params({ reason: '  Травма  ' }))
        const data = tx.subscriptionFreeze.create.mock.calls[0][0].data
        expect(data.fromDate.toISOString()).toBe('2026-10-24T00:00:00.000Z')
        expect(data.untilDate.toISOString()).toBe('2026-10-30T00:00:00.000Z')
        expect(data.reason).toBe('Травма')
        expect(data.userId).toBe('u1')
    })

    it('honours an explicit future fromDate', async () => {
        const tx = setup()
        await svcWith(tx).create(params({ fromDate: '2026-11-01', days: 3 }))
        const data = tx.subscriptionFreeze.create.mock.calls[0][0].data
        expect(data.fromDate.toISOString()).toBe('2026-11-01T00:00:00.000Z')
        expect(data.untilDate.toISOString()).toBe('2026-11-03T00:00:00.000Z')
    })

    it('refuses when an open freeze exists, naming its range', async () => {
        const tx = setup()
        tx.subscriptionFreeze.findFirst.mockResolvedValue({
            fromDate: new Date('2026-11-01T00:00:00Z'),
            untilDate: new Date('2026-11-07T00:00:00Z'),
        })
        await expect(svcWith(tx).create(params())).rejects.toThrow(
            /уже есть заморозка с 1 по 7 ноября/,
        )
        expect(tx.subscription.updateMany).not.toHaveBeenCalled()
    })

    it('404s an unknown abonement (or the owner)', async () => {
        const tx = setup(null as never)
        await expect(svcWith(tx).create(params())).rejects.toThrow(
            /Абонемент не найден/,
        )
    })

    it('refuses an abonement that is not the current pointer', async () => {
        const tx = setup(
            subRow({
                workspaceMember: {
                    id: 'm1',
                    userId: 'u1',
                    subscriptionId: 'other',
                    accessUntil: END,
                },
            }),
        )
        await expect(svcWith(tx).create(params())).rejects.toThrow(
            /только текущий абонемент/,
        )
    })

    it('refuses a cancelled abonement', async () => {
        const tx = setup(subRow({ status: 'CANCELLED' }))
        await expect(svcWith(tx).create(params())).rejects.toThrow(/отменён/)
    })

    it('refuses an abonement without a term', async () => {
        const tx = setup(subRow({ endDate: null }))
        await expect(svcWith(tx).create(params())).rejects.toThrow(
            /нет срока действия/,
        )
    })

    it('refuses a start in the past', async () => {
        const tx = setup()
        await expect(
            svcWith(tx).create(params({ fromDate: '2026-10-23' })),
        ).rejects.toThrow(/в прошлом/)
    })

    it('reports a lost compare-and-set and writes nothing else', async () => {
        const tx = setup()
        tx.subscription.updateMany.mockResolvedValue({ count: 0 })
        await expect(svcWith(tx).create(params())).rejects.toThrow(/изменился/)
        expect(tx.subscriptionFreeze.create).not.toHaveBeenCalled()
        expect(tx.workspaceMember.update).not.toHaveBeenCalled()
    })
})

describe('SubscriptionFreezeService.end', () => {
    const endParams = { workspaceId: 'w1', userId: 'u1', subscriptionId: 's1', freezeId: 'f1', now: NOW }
    const freezeRow = (over: Record<string, unknown> = {}) => ({
        id: 'f1',
        workspaceId: 'w1',
        subscriptionId: 's1',
        userId: 'u1',
        fromDate: new Date('2026-10-24T00:00:00Z'),
        untilDate: new Date('2026-10-30T00:00:00Z'),
        accessShifted: true,
        subscription: {
            id: 's1',
            status: 'ACTIVE',
            endDate: END,
            workspace: { timezone: 'Europe/Moscow' },
            workspaceMember: { id: 'm1', accessUntil: END },
        },
        ...over,
    })
    const setup = (row: unknown) => {
        const tx = makeTx()
        tx.subscriptionFreeze.findFirst.mockResolvedValue(row)
        tx.subscription.findUniqueOrThrow.mockResolvedValue({
            id: 's1',
            plan: { name: 'Monthly' },
        })
        return tx
    }

    it('removes an upcoming freeze and gives the whole length back to both dates', async () => {
        const tx = setup(
            freezeRow({
                fromDate: new Date('2026-11-01T00:00:00Z'),
                untilDate: new Date('2026-11-07T00:00:00Z'),
            }),
        )
        const res = await svcWith(tx).end(endParams)
        expect(tx.subscriptionFreeze.delete).toHaveBeenCalledWith({
            where: { id: 'f1' },
        })
        expect(tx.subscription.updateMany).toHaveBeenCalledWith({
            where: { id: 's1', status: 'ACTIVE', endDate: END },
            data: { endDate: new Date(END.getTime() - 7 * DAY) },
        })
        expect(tx.workspaceMember.update).toHaveBeenCalledWith({
            where: { id: 'm1' },
            data: { accessUntil: new Date(END.getTime() - 7 * DAY) },
        })
        expect(res).toMatchObject({ removed: true, freeze: null, returnedDays: 7 })
    })

    it('shrinks a running freeze to yesterday and returns the unused days', async () => {
        const tx = setup(freezeRow())
        const res = await svcWith(tx).end({
            ...endParams,
            now: new Date('2026-10-27T10:00:00Z'),
        })
        expect(tx.subscriptionFreeze.update).toHaveBeenCalledWith({
            where: { id: 'f1' },
            data: {
                untilDate: new Date('2026-10-26T00:00:00Z'),
                endedEarlyAt: new Date('2026-10-27T10:00:00Z'),
            },
        })
        expect(tx.subscription.updateMany.mock.calls[0][0].data.endDate).toEqual(
            new Date(END.getTime() - 4 * DAY),
        )
        expect(res.removed).toBe(false)
        expect(res.returnedDays).toBe(4)
        expect(res.original.untilDate.toISOString()).toBe('2026-10-30T00:00:00.000Z')
    })

    it('leaves accessUntil untouched when the freeze did not shift it', async () => {
        const tx = setup(freezeRow({ accessShifted: false }))
        const res = await svcWith(tx).end({
            ...endParams,
            now: new Date('2026-10-27T10:00:00Z'),
        })
        expect(tx.workspaceMember.update).not.toHaveBeenCalled()
        expect(res.accessUntil).toEqual(END)
    })

    it('refuses a freeze that is already over', async () => {
        const tx = setup(freezeRow())
        await expect(
            svcWith(tx).end({ ...endParams, now: new Date('2026-11-02T10:00:00Z') }),
        ).rejects.toThrow(/уже закончилась/)
        expect(tx.subscription.updateMany).not.toHaveBeenCalled()
    })

    it('404s an unknown freeze', async () => {
        const tx = setup(null)
        await expect(svcWith(tx).end(endParams)).rejects.toThrow(
            /Заморозка не найдена/,
        )
    })

    it('refuses to change the freeze of a cancelled abonement', async () => {
        const row = freezeRow()
        row.subscription.status = 'CANCELLED'
        const tx = setup(row)
        await expect(svcWith(tx).end(endParams)).rejects.toThrow(
            /заморозку изменить нельзя/,
        )
    })

    it('reports a lost compare-and-set', async () => {
        const tx = setup(freezeRow())
        tx.subscription.updateMany.mockResolvedValue({ count: 0 })
        await expect(svcWith(tx).end(endParams)).rejects.toThrow(/изменился/)
        expect(tx.subscriptionFreeze.update).not.toHaveBeenCalled()
    })
})

describe('releaseOpenFreezesInTx', () => {
    const sub = {
        id: 's1',
        endDate: END,
        workspace: { timezone: 'Europe/Moscow' },
        workspaceMember: { id: 'm1', accessUntil: END },
    }

    it('writes nothing when there are no open freezes', async () => {
        const tx = makeTx()
        const days = await releaseOpenFreezesInTx(tx as never, {
            subscription: sub,
            now: NOW,
        })
        expect(days).toBe(0)
        expect(tx.subscription.updateMany).not.toHaveBeenCalled()
        expect(tx.workspaceMember.update).not.toHaveBeenCalled()
    })

    it('gives back every open freeze, chaining the dates', async () => {
        const tx = makeTx()
        tx.subscriptionFreeze.findMany.mockResolvedValue([
            {
                id: 'f1',
                fromDate: new Date('2026-10-22T00:00:00Z'),
                untilDate: new Date('2026-10-26T00:00:00Z'),
                accessShifted: true,
            },
            {
                id: 'f2',
                fromDate: new Date('2026-11-01T00:00:00Z'),
                untilDate: new Date('2026-11-03T00:00:00Z'),
                accessShifted: true,
            },
        ])
        const days = await releaseOpenFreezesInTx(tx as never, {
            subscription: sub,
            now: NOW,
        })
        // f1 is running (24..26 left = 3 days), f2 is upcoming (3 days).
        expect(days).toBe(6)
        const wheres = tx.subscription.updateMany.mock.calls.map(
            (c) => c[0].where.endDate,
        )
        expect(wheres[0]).toEqual(END)
        expect(wheres[1]).toEqual(new Date(END.getTime() - 3 * DAY))
        expect(tx.subscription.updateMany.mock.calls[1][0].data.endDate).toEqual(
            new Date(END.getTime() - 6 * DAY),
        )
    })
})
