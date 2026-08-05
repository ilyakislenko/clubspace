import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import { DEFAULT_ACHIEVEMENTS } from '../get-my-achievements/achievements-math'
import { buildAchievementList } from './list-with-counts'
import {
    SeedDefaultAchievementsFeature,
    SeedDefaultAchievementsFeatureResponse,
} from './seed-default-achievements.feature'

@Feature(SeedDefaultAchievementsFeature)
export class SeedDefaultAchievementsHandler
    implements
        IFeatureHandler<
            SeedDefaultAchievementsFeature,
            SeedDefaultAchievementsFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: SeedDefaultAchievementsFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            'Управлять достижениями может только администратор клуба',
        )

        const existing = await this.prisma.achievement.count({
            where: { workspaceId: f.workspaceId },
        })
        // Only seed into an empty set, so it never duplicates a club's own list.
        if (existing === 0) {
            await this.prisma.achievement.createMany({
                data: DEFAULT_ACHIEVEMENTS.map((a, i) => ({
                    workspaceId: f.workspaceId,
                    name: a.name,
                    description: a.description,
                    icon: a.icon,
                    metric:
                        a.metric === 'streak'
                            ? ('STREAK' as const)
                            : ('CHECKINS' as const),
                    threshold: a.threshold,
                    order: i,
                })),
            })
        }

        return buildAchievementList(this.prisma, f.workspaceId)
    }
}
