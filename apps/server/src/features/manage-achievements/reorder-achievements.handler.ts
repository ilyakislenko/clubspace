import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
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
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        // Every reordered achievement must be in a direction the caller runs;
        // a club-wide one in the set keeps the reorder admin-only.
        const rows = await this.prisma.achievement.findMany({
            where: { id: { in: f.payload.ids }, workspaceId: f.workspaceId },
            select: { directionId: true },
        })
        await this.rbac.assertCanManageDirection(
            ctx,
            ...rows.map((r) => r.directionId),
        )
        const directionIds = await this.rbac.assertManagesDirections(ctx)
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
        return buildAchievementList(this.prisma, f.workspaceId, directionIds)
    }
}
