import { countActiveStudentsMany } from './active-students'

const NOW = new Date('2026-11-14T09:00:00.000Z')
const DAY = 24 * 3600_000

describe('countActiveStudentsMany', () => {
    it('counts each club’s students seen or present in 30 days; a club with nobody reads 0', async () => {
        const groupBy = jest.fn().mockResolvedValue([{ workspaceId: 'w1', _count: { _all: 42 } }])
        const result = await countActiveStudentsMany(
            { workspaceMember: { groupBy } } as never,
            [
                { id: 'w1', ownerId: 'owner' },
                { id: 'w2', ownerId: 'o2' },
            ],
            NOW,
        )
        expect(result).toEqual(
            new Map([
                ['w1', 42],
                ['w2', 0],
            ]),
        )
        const since = new Date(NOW.getTime() - 30 * DAY)
        const where = groupBy.mock.calls[0][0].where
        // Each club's own students (its owner excluded), active by either signal.
        expect(where.AND[0].OR.map((w: { workspaceId: string; userId: unknown }) => [w.workspaceId, w.userId])).toEqual([
            ['w1', { not: 'owner' }],
            ['w2', { not: 'o2' }],
        ])
        expect(where.AND[1]).toEqual({
            OR: [{ lastAttendedAt: { gte: since } }, { lastSeenAt: { gte: since } }],
        })
    })

    it('skips the query for an empty page', async () => {
        const groupBy = jest.fn()
        await expect(
            countActiveStudentsMany({ workspaceMember: { groupBy } } as never, [], NOW),
        ).resolves.toEqual(new Map())
        expect(groupBy).not.toHaveBeenCalled()
    })
})
