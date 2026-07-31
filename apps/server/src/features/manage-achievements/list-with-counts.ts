import { PrismaService } from '../../infrastructure/prisma'
import { weekIndex } from '../attendance-leaderboard/leaderboard-math'
import {
    countUnlockedBy,
    longestStreakWeeks,
} from '../get-my-achievements/achievements-math'
import { AchievementListItem, serializeAchievement } from './schemas'

// The workspace's achievements plus, for each, how many members have unlocked
// it — so an admin can see which badges are motivating vs. out of reach. Shared
// by list / seed / reorder so all three return the same shape.
export const buildAchievementList = async (
    prisma: PrismaService,
    workspaceId: string,
): Promise<{ data: AchievementListItem[] }> => {
    const [rows, records] = await Promise.all([
        prisma.achievement.findMany({
            where: { workspaceId },
            orderBy: [{ order: 'asc' }, { threshold: 'asc' }],
        }),
        prisma.attendanceRecord.findMany({
            where: { workspaceId },
            select: { userId: true, markedAt: true },
            orderBy: { markedAt: 'asc' },
        }),
    ])

    // Per-member totals (records arrive globally asc, so each member's slice is
    // asc too — needed for the streak run).
    const byUser = new Map<string, Date[]>()
    for (const r of records) {
        const arr = byUser.get(r.userId)
        if (arr) arr.push(r.markedAt)
        else byUser.set(r.userId, [r.markedAt])
    }
    const members = [...byUser.values()].map((dates) => ({
        total: dates.length,
        longest: longestStreakWeeks(dates.map(weekIndex)),
    }))

    const counts = countUnlockedBy(
        rows.map((r) => ({
            id: r.id,
            metric: r.metric === 'STREAK' ? 'streak' : 'checkins',
            threshold: r.threshold,
        })),
        members,
    )

    return {
        data: rows.map((r) => ({
            ...serializeAchievement(r),
            unlockedBy: counts[r.id] ?? 0,
        })),
    }
}
