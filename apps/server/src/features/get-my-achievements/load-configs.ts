import { PrismaService } from '../../infrastructure/prisma'
import {
    AchievementConfig,
    DEFAULT_ACHIEVEMENTS,
} from './achievements-math'

// The active achievements a workspace has configured, in display order — or the
// built-in default ladder when it has configured none (so existing clubs keep
// working unchanged).
export const loadAchievementConfigs = async (
    prisma: PrismaService,
    workspaceId: string,
): Promise<AchievementConfig[]> => {
    const rows = await prisma.achievement.findMany({
        where: { workspaceId, isActive: true },
        orderBy: [{ order: 'asc' }, { threshold: 'asc' }],
    })
    if (rows.length === 0) return DEFAULT_ACHIEVEMENTS
    return rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        icon: r.icon,
        metric: r.metric === 'STREAK' ? 'streak' : 'checkins',
        threshold: r.threshold,
    }))
}
