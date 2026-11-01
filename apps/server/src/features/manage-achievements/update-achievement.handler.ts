import { Feature, IFeatureHandler } from '@shelfjs/features'

import { assertDirectionInWorkspace } from '../../domains/directions/direction-scope'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    UpdateAchievementFeature,
    UpdateAchievementFeatureResponse,
} from './update-achievement.feature'
import { serializeAchievement } from './schemas'

@Feature(UpdateAchievementFeature)
export class UpdateAchievementHandler
    implements
        IFeatureHandler<
            UpdateAchievementFeature,
            UpdateAchievementFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: UpdateAchievementFeature) {
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
        const p = f.payload
        await assertDirectionInWorkspace(
            this.prisma,
            f.workspaceId,
            p.directionId,
        )
        await this.rbac.assertCanManageDirection(
            ctx,
            existing.directionId,
            p.directionId,
        )
        const updated = await this.prisma.achievement.update({
            where: { id: existing.id },
            data: {
                ...(p.name !== undefined ? { name: p.name } : {}),
                ...(p.description !== undefined
                    ? { description: p.description?.trim() || null }
                    : {}),
                ...(p.icon !== undefined
                    ? { icon: p.icon?.trim() || null }
                    : {}),
                ...(p.metric !== undefined ? { metric: p.metric } : {}),
                ...(p.threshold !== undefined
                    ? { threshold: p.threshold }
                    : {}),
                ...(p.isActive !== undefined ? { isActive: p.isActive } : {}),
                ...(p.order !== undefined ? { order: p.order } : {}),
                ...(p.directionId !== undefined
                    ? { directionId: p.directionId }
                    : {}),
            },
        })
        return serializeAchievement(updated)
    }
}
