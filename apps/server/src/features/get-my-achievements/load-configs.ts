import { PrismaService } from '../../infrastructure/prisma'
import {
    AchievementConfig,
    DEFAULT_ACHIEVEMENTS,
} from './achievements-math'

// An active direction that has at least one active achievement.
export type AchievementDirection = {
    id: string
    name: string
    color: string | null
    icon: string | null
    order: number
}

export type LoadedAchievementConfigs = {
    configs: AchievementConfig[]
    // Directions of the direction achievements in `configs`, by direction order.
    directions: AchievementDirection[]
}

// The active achievements a workspace has configured, in display order — or the
// built-in default ladder when it has configured none (so existing clubs keep
// working unchanged). Achievements of a deactivated direction are left out.
export const loadAchievementConfigs = async (
    prisma: PrismaService,
    workspaceId: string,
): Promise<LoadedAchievementConfigs> => {
    const rows = await prisma.achievement.findMany({
        where: { workspaceId, isActive: true },
        orderBy: [{ order: 'asc' }, { threshold: 'asc' }],
        include: {
            direction: {
                select: {
                    id: true,
                    name: true,
                    color: true,
                    icon: true,
                    order: true,
                    isActive: true,
                },
            },
        },
    })
    if (rows.length === 0) {
        return { configs: DEFAULT_ACHIEVEMENTS, directions: [] }
    }
    const directions = new Map<string, AchievementDirection>()
    const configs: AchievementConfig[] = []
    for (const r of rows) {
        if (r.directionId) {
            // directionId set but the direction gone/inactive → not shown.
            if (!r.direction?.isActive) continue
            const d = r.direction
            directions.set(d.id, {
                id: d.id,
                name: d.name,
                color: d.color,
                icon: d.icon,
                order: d.order,
            })
        }
        configs.push({
            id: r.id,
            name: r.name,
            description: r.description,
            icon: r.icon,
            metric: r.metric === 'STREAK' ? 'streak' : 'checkins',
            threshold: r.threshold,
            directionId: r.directionId,
        })
    }
    return {
        configs,
        directions: [...directions.values()].sort(
            (a, b) => a.order - b.order || a.name.localeCompare(b.name),
        ),
    }
}
