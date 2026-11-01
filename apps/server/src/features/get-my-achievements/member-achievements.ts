import {
    loadMemberDirectionIds,
    sessionDirectionId,
    sessionDirectionSelect,
} from '../../domains/directions/direction-scope'
import { PrismaService } from '../../infrastructure/prisma'
import {
    checkInsByDirection,
    checkInSummary,
    computeAchievements,
} from './achievements-math'
import type { GetMyAchievementsFeatureResponse } from './get-my-achievements.feature'
import {
    loadAchievementConfigs,
    type LoadedAchievementConfigs,
} from './load-configs'
import {
    buildMemberStats,
    countCompletedSubscriptions,
} from './load-member-stats'

const NO_ACHIEVEMENTS: LoadedAchievementConfigs = {
    configs: [],
    directions: [],
}

// One member's achievements view (shared by the member's own and the staff
// endpoint). Totals, streaks, weekly bars and stats are club-wide; direction
// achievements are judged on that direction's visits and shown only for the
// directions the member trains in / coaches or has visited.
export const loadMemberAchievements = async (
    prisma: PrismaService,
    workspaceId: string,
    userId: string,
    achievementsOn: boolean,
): Promise<GetMyAchievementsFeatureResponse> => {
    const now = new Date()
    const [loaded, rows, completed] = await Promise.all([
        achievementsOn
            ? loadAchievementConfigs(prisma, workspaceId)
            : Promise.resolve(NO_ACHIEVEMENTS),
        prisma.attendanceRecord.findMany({
            where: { workspaceId, userId },
            select: {
                markedAt: true,
                session: {
                    select: {
                        startAt: true,
                        timezone: true,
                        ...sessionDirectionSelect,
                    },
                },
            },
            orderBy: { markedAt: 'asc' },
        }),
        countCompletedSubscriptions(prisma, workspaceId, userId, now),
    ])
    const stats = buildMemberStats(
        rows.map((r) => ({
            startAt: r.session.startAt,
            timezone: r.session.timezone,
        })),
        completed,
        now,
    )
    const byDirection = checkInsByDirection(
        rows.map((r) => ({
            markedAt: r.markedAt,
            directionId: sessionDirectionId(r.session),
        })),
    )

    // Only clubs with direction achievements pay for the roster lookup.
    const memberDirections =
        loaded.directions.length > 0
            ? await loadMemberDirectionIds(prisma, workspaceId, userId)
            : new Set<string>()
    const shown = loaded.directions.filter(
        (d) => memberDirections.has(d.id) || byDirection.has(d.id),
    )
    const shownIds = new Set(shown.map((d) => d.id))
    const configs = loaded.configs.filter(
        (c) => c.directionId === null || shownIds.has(c.directionId),
    )

    return {
        ...computeAchievements(
            configs,
            rows.map((r) => r.markedAt),
            now,
            byDirection,
        ),
        directions: shown.map((d) => ({
            id: d.id,
            name: d.name,
            color: d.color,
            icon: d.icon,
            ...checkInSummary(byDirection.get(d.id) ?? [], now),
        })),
        stats,
    }
}
