import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
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
        const existing = await this.prisma.achievement.findFirst({
            where: { id: f.achievementId, workspaceId: f.workspaceId },
            select: { id: true },
        })
        if (!existing) {
            throw new NotFoundError({ message: 'Достижение не найдено' })
        }
        const p = f.payload
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
            },
        })
        return serializeAchievement(updated)
    }
}
