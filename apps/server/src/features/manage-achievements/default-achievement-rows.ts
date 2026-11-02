import type { ClubVocabulary } from '../../shared/utils/club-vocabulary'
import { defaultAchievements } from '../get-my-achievements/achievements-math'

// The built-in ladder as `achievement.createMany` rows for one scope: a
// direction, or club-wide when `directionId` is null. Named in the club's
// words («1 занятие» in a dance studio).
export const defaultAchievementRows = (
    workspaceId: string,
    directionId: string | null,
    vocabulary: ClubVocabulary,
) =>
    defaultAchievements(vocabulary).map((a, i) => ({
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
