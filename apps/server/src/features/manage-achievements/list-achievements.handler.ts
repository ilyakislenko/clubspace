import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ListAchievementsFeature,
    ListAchievementsFeatureResponse,
} from './list-achievements.feature'
import { buildAchievementList } from './list-with-counts'

@Feature(ListAchievementsFeature)
export class ListAchievementsHandler
    implements
        IFeatureHandler<
            ListAchievementsFeature,
            ListAchievementsFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListAchievementsFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const directionIds = await this.rbac.assertManagesDirections(ctx)
        return buildAchievementList(this.prisma, f.workspaceId, directionIds)
    }
}
