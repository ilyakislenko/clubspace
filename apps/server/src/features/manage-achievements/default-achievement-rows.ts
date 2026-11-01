import { DEFAULT_ACHIEVEMENTS } from '../get-my-achievements/achievements-math'

// The built-in ladder as `achievement.createMany` rows for one scope: a
// direction, or club-wide when `directionId` is null.
export const defaultAchievementRows = (
    workspaceId: string,
    directionId: string | null,
) =>
    DEFAULT_ACHIEVEMENTS.map((a, i) => ({
        workspaceId,
        directionId,
        name: a.name,
        description: a.description,
        icon: a.icon,
        metric:
            a.metric === 'streak' ? ('STREAK' as const) : ('CHECKINS' as const),
        threshold: a.threshold,
        order: i,
    }))
