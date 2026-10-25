import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { computeAchievements } from './achievements-math'
import {
    GetMyAchievementsFeature,
    GetMyAchievementsFeatureResponse,
} from './get-my-achievements.feature'
import { loadAchievementConfigs } from './load-configs'

@Feature(GetMyAchievementsFeature)
export class GetMyAchievementsHandler
    implements
        IFeatureHandler<
            GetMyAchievementsFeature,
            GetMyAchievementsFeatureResponse
        >
{
    constructor(private readonly prisma: PrismaService) {}

    async execute(f: GetMyAchievementsFeature) {
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { achievementsEnabled: true },
        })
        // Off: no achievement list, but the streak and weekly bars (shared with
        // the attendance card) still come back — never a 403 for the app.
        const achievementsOn = workspace?.achievementsEnabled !== false
        const [configs, rows] = await Promise.all([
            achievementsOn
                ? loadAchievementConfigs(this.prisma, f.workspaceId)
                : Promise.resolve([]),
            this.prisma.attendanceRecord.findMany({
                where: { workspaceId: f.workspaceId, userId: f.userId },
                select: { markedAt: true },
                orderBy: { markedAt: 'asc' },
            }),
        ])
        return computeAchievements(
            configs,
            rows.map((r) => r.markedAt),
            new Date(),
        )
    }
}
