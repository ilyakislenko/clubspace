import { Feature, IFeatureHandler } from '@shelfjs/features'

import { assertDirectionInWorkspace } from '../../domains/directions/direction-scope'
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

        const directionId = f.payload.directionId ?? null
        await assertDirectionInWorkspace(
            this.prisma,
            f.workspaceId,
            directionId,
        )
        const existing = await this.prisma.achievement.count({
            where: { workspaceId: f.workspaceId, directionId },
        })
        // Only seed into an empty scope (this direction, or club-wide), so it
        // never duplicates a ladder while each direction can get its own.
        if (existing === 0) {
            await this.prisma.achievement.createMany({
                data: DEFAULT_ACHIEVEMENTS.map((a, i) => ({
                    workspaceId: f.workspaceId,
                    directionId,
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
