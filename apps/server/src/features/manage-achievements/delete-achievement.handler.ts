import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
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
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const existing = await this.prisma.achievement.findFirst({
            where: { id: f.achievementId, workspaceId: f.workspaceId },
            select: { id: true, directionId: true },
        })
        if (!existing) {
            throw new NotFoundError({ message: 'Достижение не найдено' })
        }
        await this.rbac.assertCanManageDirection(ctx, existing.directionId)
        await this.prisma.achievement.delete({ where: { id: existing.id } })
        return { status: 'deleted' as const }
    }
}
