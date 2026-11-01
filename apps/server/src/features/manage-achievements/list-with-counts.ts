import {
    sessionDirectionId,
    sessionDirectionSelect,
} from '../../domains/directions/direction-scope'
import { PrismaService } from '../../infrastructure/prisma'
import { weekIndex } from '../attendance-leaderboard/leaderboard-math'
import {
    countUnlockedBy,
    longestStreakWeeks,
    type MemberMetric,
} from '../get-my-achievements/achievements-math'
import { AchievementListItem, serializeAchievement } from './schemas'

const CLUB_WIDE = 'all'

// The workspace's achievements plus, for each, how many members have unlocked
// it — so an admin can see which badges are motivating vs. out of reach. Shared
// by list / seed / reorder so all three return the same shape. A direction
// achievement is counted on each member's visits in that direction only.
// directionIds: null = admin (every row); else a direction manager's
// directions (no club-wide rows).
export const buildAchievementList = async (
    prisma: PrismaService,
    workspaceId: string,
    directionIds: string[] | null = null,
): Promise<{ data: AchievementListItem[] }> => {
    const [rows, records] = await Promise.all([
        prisma.achievement.findMany({
            where: {
                workspaceId,
                ...(directionIds ? { directionId: { in: directionIds } } : {}),
            },
            orderBy: [{ order: 'asc' }, { threshold: 'asc' }],
        }),
        prisma.attendanceRecord.findMany({
            where: { workspaceId },
            select: {
                userId: true,
                markedAt: true,
                session: { select: sessionDirectionSelect },
            },
            orderBy: { markedAt: 'asc' },
        }),
    ])

    // scope (direction id or CLUB_WIDE) → member → visit dates. Records arrive
    // globally asc, so each slice is asc too — needed for the streak run.
    const byScope = new Map<string, Map<string, Date[]>>()
    const push = (scope: string, userId: string, at: Date) => {
        let users = byScope.get(scope)
        if (!users) byScope.set(scope, (users = new Map()))
        const arr = users.get(userId)
        if (arr) arr.push(at)
        else users.set(userId, [at])
    }
    for (const r of records) {
        push(CLUB_WIDE, r.userId, r.markedAt)
        const dir = sessionDirectionId(r.session)
        if (dir) push(dir, r.userId, r.markedAt)
    }
    const counts: Record<string, number> = {}
    const scopes = new Set(rows.map((r) => r.directionId ?? CLUB_WIDE))
    for (const scope of scopes) {
        const members: MemberMetric[] = [
            ...(byScope.get(scope)?.values() ?? []),
        ].map((dates) => ({
            total: dates.length,
            longest: longestStreakWeeks(dates.map(weekIndex)),
        }))
        Object.assign(
            counts,
            countUnlockedBy(
                rows
                    .filter((r) => (r.directionId ?? CLUB_WIDE) === scope)
                    .map((r) => ({
                        id: r.id,
                        metric: r.metric === 'STREAK' ? 'streak' : 'checkins',
                        threshold: r.threshold,
                    })),
                members,
            ),
        )
    }

    return {
        data: rows.map((r) => ({
            ...serializeAchievement(r),
            unlockedBy: counts[r.id] ?? 0,
        })),
    }
}
