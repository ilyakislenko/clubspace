import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import { buildAchievementList } from './list-with-counts'
import {
    ReorderAchievementsFeature,
    ReorderAchievementsFeatureResponse,
} from './reorder-achievements.feature'

@Feature(ReorderAchievementsFeature)
export class ReorderAchievementsHandler
    implements
        IFeatureHandler<
            ReorderAchievementsFeature,
            ReorderAchievementsFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ReorderAchievementsFeature) {
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
        // Write order = position; updateMany is scoped to the workspace so a
        // foreign id in the list simply matches nothing.
        await this.prisma.$transaction(
            f.payload.ids.map((id, index) =>
                this.prisma.achievement.updateMany({
                    where: { id, workspaceId: f.workspaceId },
                    data: { order: index },
                }),
            ),
        )
        return buildAchievementList(this.prisma, f.workspaceId)
    }
}
