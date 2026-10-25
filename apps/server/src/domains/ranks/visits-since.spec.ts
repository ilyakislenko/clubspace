import { countVisitsSince } from './visits-since'

const makePrisma = () => ({
    attendanceRecord: {
        groupBy: jest.fn().mockImplementation(({ where }) =>
            Promise.resolve(
                where.OR.map((o: { userId: string }) => ({
                    userId: o.userId,
                    _count: { _all: 2 },
                })),
            ),
        ),
    },
})

describe('countVisitsSince', () => {
    it('builds one OR branch per member with its own cut-off', async () => {
        const prisma = makePrisma()
        const since = new Date('2026-01-01T00:00:00Z')
        const out = await countVisitsSince(prisma as never, 'w1', [
            { userId: 'a', since },
        ])
        expect(prisma.attendanceRecord.groupBy.mock.calls[0][0]).toEqual({
            by: ['userId'],
            where: {
                workspaceId: 'w1',
                OR: [{ userId: 'a', markedAt: { gte: since } }],
            },
            _count: { _all: true },
        })
        expect(out.get('a')).toBe(2)
    })

    it('queries in chunks of 500', async () => {
        const prisma = makePrisma()
        const items = Array.from({ length: 1001 }, (_, i) => ({
            userId: `u${i}`,
            since: new Date(0),
        }))
        const out = await countVisitsSince(prisma as never, 'w1', items)
        expect(prisma.attendanceRecord.groupBy).toHaveBeenCalledTimes(3)
        expect(
            prisma.attendanceRecord.groupBy.mock.calls.map(
                (c) => c[0].where.OR.length,
            ),
        ).toEqual([500, 500, 1])
        expect(out.size).toBe(1001)
    })

    it('does not query for an empty list', async () => {
        const prisma = makePrisma()
        expect((await countVisitsSince(prisma as never, 'w1', [])).size).toBe(0)
        expect(prisma.attendanceRecord.groupBy).not.toHaveBeenCalled()
    })
})
