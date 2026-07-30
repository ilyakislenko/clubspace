import { GetMyAchievementsFeature } from './get-my-achievements.feature'
import { GetMyAchievementsHandler } from './get-my-achievements.handler'

const makePrisma = (markedAts: Date[]) => ({
    // No configured achievements → the loader falls back to defaults.
    achievement: { findMany: jest.fn().mockResolvedValue([]) },
    attendanceRecord: {
        findMany: jest
            .fn()
            .mockResolvedValue(markedAts.map((markedAt) => ({ markedAt }))),
    },
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (prisma: any) =>
    new GetMyAchievementsHandler(prisma).execute(
        new GetMyAchievementsFeature('w1', 'u1'),
    )

describe('getMyAchievements', () => {
    it('queries the member’s own check-ins ascending and returns totals', async () => {
        const prisma = makePrisma([
            new Date('2026-01-01T10:00:00Z'),
            new Date('2026-01-08T10:00:00Z'),
        ])
        const out = await run(prisma)
        const args = prisma.attendanceRecord.findMany.mock.calls[0][0]
        expect(args.where).toEqual({ workspaceId: 'w1', userId: 'u1' })
        expect(args.orderBy).toEqual({ markedAt: 'asc' })
        expect(out.totalCheckIns).toBe(2)
        expect(
            out.achievements.find((m) => m.threshold === 1)?.unlocked,
        ).toBe(true)
    })

    it('handles a member with no check-ins', async () => {
        const out = await run(makePrisma([]))
        expect(out.totalCheckIns).toBe(0)
        expect(out.nextMilestone).toBe(1)
    })
})
