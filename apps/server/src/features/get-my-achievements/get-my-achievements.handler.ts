import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { computeAchievements } from './achievements-math'
import {
    GetMyAchievementsFeature,
    GetMyAchievementsFeatureResponse,
} from './get-my-achievements.feature'
import { loadAchievementConfigs } from './load-configs'
import {
    buildMemberStats,
    countCompletedSubscriptions,
} from './load-member-stats'

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
        const now = new Date()
        const [configs, rows, completed] = await Promise.all([
            achievementsOn
                ? loadAchievementConfigs(this.prisma, f.workspaceId)
                : Promise.resolve([]),
            this.prisma.attendanceRecord.findMany({
                where: { workspaceId: f.workspaceId, userId: f.userId },
                select: {
                    markedAt: true,
                    session: { select: { startAt: true, timezone: true } },
                },
                orderBy: { markedAt: 'asc' },
            }),
            countCompletedSubscriptions(
                this.prisma,
                f.workspaceId,
                f.userId,
                now,
            ),
        ])
        const stats = buildMemberStats(
            rows.map((r) => r.session),
            completed,
            now,
        )
        return {
            ...computeAchievements(
                configs,
                rows.map((r) => r.markedAt),
                now,
            ),
            stats,
        }
    }
}
