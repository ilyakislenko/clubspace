import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
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
        return buildAchievementList(this.prisma, f.workspaceId)
    }
}
