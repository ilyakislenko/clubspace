import { GetMemberAchievementsFeature } from './get-member-achievements.feature'
import { GetMemberAchievementsHandler } from './get-member-achievements.handler'

const makePrisma = (markedAts: Date[]) => ({
    workspace: {
        findUnique: jest.fn().mockResolvedValue({ timezone: 'UTC' }),
    },
    subscription: { count: jest.fn().mockResolvedValue(1) },
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

describe('getMemberAchievements', () => {
    it('queries the target member’s check-ins and computes achievements', async () => {
        const prisma = makePrisma([
            new Date('2026-01-01T10:00:00Z'),
            new Date('2026-01-08T10:00:00Z'),
        ])
        const out = await new GetMemberAchievementsHandler(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            prisma as any,
        ).execute(new GetMemberAchievementsFeature('w1', 'target'))
        expect(prisma.attendanceRecord.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            userId: 'target',
        })
        expect(out.totalCheckIns).toBe(2)
        expect(out.stats.firstTrainingDate).toBe('2026-01-01')
        expect(out.stats.completedSubscriptions).toBe(1)
        expect(
            prisma.subscription.count.mock.calls[0][0].where.workspaceMember,
        ).toEqual({ userId: 'target' })
    })
})
