import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ListAchievementsFeature,
    ListAchievementsFeatureResponse,
} from './list-achievements.feature'
import { serializeAchievement } from './schemas'

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
            'Only workspace admins can manage achievements',
        )
        const rows = await this.prisma.achievement.findMany({
            where: { workspaceId: f.workspaceId },
            orderBy: [{ order: 'asc' }, { threshold: 'asc' }],
        })
        return { data: rows.map(serializeAchievement) }
    }
}
