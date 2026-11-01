import { Feature, IFeatureHandler } from '@shelfjs/features'

import { assertDirectionInWorkspace } from '../../domains/directions/direction-scope'
import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import { defaultAchievementRows } from './default-achievement-rows'
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
                data: defaultAchievementRows(f.workspaceId, directionId),
            })
        }

        return buildAchievementList(this.prisma, f.workspaceId)
    }
}
