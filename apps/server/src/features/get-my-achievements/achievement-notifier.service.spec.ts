import { AchievementNotifierService } from './achievement-notifier.service'

const makePrisma = (achievementsEnabled: boolean) => ({
    workspace: {
        findUnique: jest.fn().mockResolvedValue({ achievementsEnabled }),
    },
    // No configured achievements → the loader falls back to the defaults
    // (first one unlocks at 1 check-in).
    achievement: { findMany: jest.fn().mockResolvedValue([]) },
    attendanceRecord: {
        findMany: jest
            .fn()
            .mockResolvedValue([{ markedAt: new Date('2026-01-01T10:00:00Z') }]),
    },
})

const run = async (achievementsEnabled: boolean) => {
    const prisma = makePrisma(achievementsEnabled)
    const notifyUser = jest.fn().mockResolvedValue(undefined)
    await new AchievementNotifierService(
        prisma as never,
        { notifyUser } as never,
    ).notifyUnlocked('u1', 'w1')
    return { prisma, notifyUser }
}

describe('AchievementNotifierService', () => {
    it('celebrates under the achievements flag', async () => {
        const { notifyUser } = await run(true)
        expect(notifyUser).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'achievement.unlocked',
                workspaceId: 'w1',
                feature: 'achievements',
            }),
        )
    })

    it('skips the history computation when achievements are off', async () => {
        const { prisma, notifyUser } = await run(false)
        expect(prisma.attendanceRecord.findMany).not.toHaveBeenCalled()
        expect(notifyUser).not.toHaveBeenCalled()
    })
})
