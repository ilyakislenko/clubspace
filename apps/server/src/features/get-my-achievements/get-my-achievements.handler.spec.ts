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
                    session: { startAt: markedAt, timezone: 'UTC' },
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
        expect(sub.OR).toContainEqual({
            classesTotal: { not: null },
            classesRemaining: { lte: 0 },
        })
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
        expect(out.directions).toEqual([])
    })
})

describe('getMyAchievements with directions', () => {
    const BJJ = '11111111-1111-4111-8111-111111111111'
    const MMA = '22222222-2222-4222-8222-222222222222'
    const MUAY = '33333333-3333-4333-8333-333333333333'
    const dir = (id: string, name: string, order: number) => ({
        id,
        name,
        color: null,
        icon: null,
        order,
        isActive: true,
    })
    const ach = (
        id: string,
        threshold: number,
        direction: ReturnType<typeof dir> | null,
    ) => ({
        id,
        name: id,
        description: null,
        icon: null,
        metric: 'CHECKINS',
        threshold,
        directionId: direction?.id ?? null,
        direction,
    })
    const visit = (day: number, directionId: string | null) => {
        const markedAt = new Date(Date.UTC(2026, 0, day, 10))
        return {
            markedAt,
            session: {
                startAt: markedAt,
                timezone: 'UTC',
                group: directionId ? { directionId } : null,
                workspaceEvent: null,
            },
        }
    }
    const makeDirPrisma = (memberOf: string[]) => ({
        workspace: {
            findUnique: jest.fn().mockResolvedValue({ achievementsEnabled: true }),
        },
        subscription: { count: jest.fn().mockResolvedValue(0) },
        achievement: {
            findMany: jest.fn().mockResolvedValue([
                ach('club3', 3, null),
                ach('mma2', 2, dir(MMA, 'ММА', 1)),
                ach('bjj2', 2, dir(BJJ, 'БЖЖ', 0)),
                ach('muay1', 1, dir(MUAY, 'Тайский бокс', 2)),
                // A deactivated direction's ladder never shows.
                {
                    ...ach('old1', 1, dir('d-old', 'Старое', 3)),
                    direction: { ...dir('d-old', 'Старое', 3), isActive: false },
                },
            ]),
        },
        attendanceRecord: {
            findMany: jest.fn().mockResolvedValue([
                visit(1, BJJ),
                visit(8, MMA),
                visit(15, null),
            ]),
        },
        groupMember: {
            findMany: jest.fn().mockResolvedValue(
                memberOf.map((directionId) => ({ group: { directionId } })),
            ),
        },
        groupCoach: { findMany: jest.fn().mockResolvedValue([]) },
    })

    it('judges a direction achievement on that direction’s visits only', async () => {
        const out = await run(makeDirPrisma([BJJ]))
        const by = Object.fromEntries(out.achievements.map((a) => [a.id, a]))
        // 3 visits club-wide → the club ladder unlocks…
        expect(by.club3.unlocked).toBe(true)
        expect(by.club3.directionId).toBeNull()
        // …but 1 БЖЖ visit and 1 ММА visit don't reach 2 in either.
        expect(by.bjj2.unlocked).toBe(false)
        expect(by.bjj2.directionId).toBe(BJJ)
        expect(by.mma2.unlocked).toBe(false)
        expect(out.totalCheckIns).toBe(3)
    })

    it('lists the member’s directions (roster or visits) in direction order and drops the rest', async () => {
        // Trains in БЖЖ, visited ММА once, never in Тайский бокс.
        const out = await run(makeDirPrisma([BJJ]))
        expect(out.directions.map((d) => d.id)).toEqual([BJJ, MMA])
        expect(out.directions[0]).toMatchObject({
            name: 'БЖЖ',
            totalCheckIns: 1,
            longestStreakWeeks: 1,
        })
        const ids = out.achievements.map((a) => a.id)
        expect(ids).not.toContain('muay1')
        expect(ids).not.toContain('old1')
    })

    it('shows a roster direction without visits, dated per direction', async () => {
        const prisma = makeDirPrisma([MUAY])
        prisma.attendanceRecord.findMany.mockResolvedValue([
            visit(1, MMA),
            visit(2, MMA),
        ])
        const out = await run(prisma)
        expect(out.directions.map((d) => d.id)).toEqual([MMA, MUAY])
        expect(out.directions[1].totalCheckIns).toBe(0)
        const mma = out.achievements.find((a) => a.id === 'mma2')!
        expect(mma.unlocked).toBe(true)
        expect(mma.achievedAt).toBe(new Date(Date.UTC(2026, 0, 2, 10)).toISOString())
        // The next milestone comes from the club-wide ladder only.
        expect(out.nextMilestone).toBe(3)
    })
})
