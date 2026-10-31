import { AchievementNotifierService } from './achievement-notifier.service'

const makePrisma = (
    achievementsEnabled: boolean,
    rows: Array<{ userId: string; markedAt: Date }> = [
        { userId: 'u1', markedAt: new Date('2026-01-01T10:00:00Z') },
    ],
) => ({
    workspace: {
        findUnique: jest.fn().mockResolvedValue({ achievementsEnabled }),
    },
    // No configured achievements → the loader falls back to the defaults
    // (first one unlocks at 1 check-in).
    achievement: { findMany: jest.fn().mockResolvedValue([]) },
    attendanceRecord: {
        findMany: jest.fn().mockResolvedValue(rows),
    },
})

const run = async (
    prisma: ReturnType<typeof makePrisma>,
    userIds: string[] = ['u1'],
) => {
    const notifyUser = jest.fn().mockResolvedValue(undefined)
    await new AchievementNotifierService(
        prisma as never,
        { notifyUser } as never,
    ).notifyUnlocked(userIds, 'w1')
    return { notifyUser }
}

describe('AchievementNotifierService', () => {
    it('celebrates under the achievements flag', async () => {
        const { notifyUser } = await run(makePrisma(true))
        expect(notifyUser).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'achievement.unlocked',
                workspaceId: 'w1',
                feature: 'achievements',
            }),
        )
    })

    it('skips the history computation when achievements are off', async () => {
        const prisma = makePrisma(false)
        const { notifyUser } = await run(prisma)
        expect(prisma.attendanceRecord.findMany).not.toHaveBeenCalled()
        expect(notifyUser).not.toHaveBeenCalled()
    })

    it('does nothing for an empty batch', async () => {
        const prisma = makePrisma(true)
        const { notifyUser } = await run(prisma, [])
        expect(prisma.workspace.findUnique).not.toHaveBeenCalled()
        expect(notifyUser).not.toHaveBeenCalled()
    })

    it('reads the whole batch in one query and judges each member on their own history', async () => {
        const at = new Date('2026-01-01T10:00:00Z')
        const prisma = makePrisma(true, [
            { userId: 'first', markedAt: at },
            { userId: 'veteran', markedAt: at },
            { userId: 'veteran', markedAt: new Date('2026-01-08T10:00:00Z') },
        ])
        const { notifyUser } = await run(prisma, ['first', 'veteran'])
        expect(prisma.attendanceRecord.findMany).toHaveBeenCalledTimes(1)
        expect(prisma.attendanceRecord.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { workspaceId: 'w1', userId: { in: ['first', 'veteran'] } },
            }),
        )
        const refIds = notifyUser.mock.calls.map(
            ([n]: [{ refId: string }]) => n.refId,
        )
        // The first-check-in badge fires for the member who just hit it...
        const firstBadge = refIds.find((r) => r.startsWith('first:'))
        expect(firstBadge).toBeDefined()
        // ...and not for the veteran, who passed that threshold long ago.
        const achievementId = firstBadge!.slice('first:'.length)
        expect(refIds).not.toContain(`veteran:${achievementId}`)
    })
})
