import { GetMyAchievementsFeature } from './get-my-achievements.feature'
import { GetMyAchievementsHandler } from './get-my-achievements.handler'

const makePrisma = (markedAts: Date[], achievementsEnabled = true) => ({
    workspace: {
        findUnique: jest
            .fn()
            .mockResolvedValue({ achievementsEnabled, timezone: 'UTC' }),
    },
    subscription: { count: jest.fn().mockResolvedValue(2) },
    // No configured achievements → the loader falls back to defaults.
    achievement: { findMany: jest.fn().mockResolvedValue([]) },
    attendanceRecord: {
        findMany: jest
            .fn()
            .mockResolvedValue(markedAts.map((markedAt) => ({
                    markedAt,
                    session: { startAt: markedAt },
                })),),
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
        expect(out.stats).toEqual({
            firstTrainingDate: '2026-01-01',
            monthsTraining: expect.any(Number),
            avgPerMonth: expect.any(Number),
            completedSubscriptions: 2,
        })
        const sub = prisma.subscription.count.mock.calls[0][0].where
        expect(sub.workspaceMember).toEqual({ userId: 'u1' })
        expect(sub.plan).toEqual({ isFreeTrial: false })
        expect(
            out.achievements.find((m) => m.threshold === 1)?.unlocked,
        ).toBe(true)
    })

    it('handles a member with no check-ins', async () => {
        const out = await run(makePrisma([]))
        expect(out.totalCheckIns).toBe(0)
        expect(out.nextMilestone).toBe(1)
    })

    it('with achievements off returns the weekly bars but no achievements', async () => {
        const prisma = makePrisma([new Date()], false)
        const out = await run(prisma)
        expect(out.achievements).toEqual([])
        expect(out.nextMilestone).toBeNull()
        expect(out.totalCheckIns).toBe(1)
        expect(out.recentWeeks).toHaveLength(12)
        expect(out.recentWeeks[11]).toBe(1)
        expect(prisma.achievement.findMany).not.toHaveBeenCalled()
    })
})
