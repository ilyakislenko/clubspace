import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    CreateAchievementFeature,
    CreateAchievementFeatureResponse,
} from './create-achievement.feature'
import { serializeAchievement } from './schemas'

@Feature(CreateAchievementFeature)
export class CreateAchievementHandler
    implements
        IFeatureHandler<
            CreateAchievementFeature,
            CreateAchievementFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: CreateAchievementFeature) {
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
        const p = f.payload
        const achievement = await this.prisma.achievement.create({
            data: {
                workspaceId: f.workspaceId,
                name: p.name,
                description: p.description?.trim() || null,
                icon: p.icon?.trim() || null,
                metric: p.metric,
                threshold: p.threshold,
                isActive: p.isActive ?? true,
                order: p.order ?? 0,
            },
        })
        return serializeAchievement(achievement)
    }
}
