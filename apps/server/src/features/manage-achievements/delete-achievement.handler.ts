import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    DeleteAchievementFeature,
    DeleteAchievementFeatureResponse,
} from './delete-achievement.feature'

@Feature(DeleteAchievementFeature)
export class DeleteAchievementHandler
    implements
        IFeatureHandler<
            DeleteAchievementFeature,
            DeleteAchievementFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: DeleteAchievementFeature) {
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
        const { count } = await this.prisma.achievement.deleteMany({
            where: { id: f.achievementId, workspaceId: f.workspaceId },
        })
        if (count === 0) {
            throw new NotFoundError({ message: 'Achievement not found' })
        }
        return { status: 'deleted' as const }
    }
}
