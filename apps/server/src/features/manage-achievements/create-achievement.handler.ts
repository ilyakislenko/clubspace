import { Feature, IFeatureHandler } from '@shelfjs/features'

import { assertDirectionInWorkspace } from '../../domains/directions/direction-scope'
import { PrismaService } from '../../infrastructure/prisma'
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
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const p = f.payload
        await assertDirectionInWorkspace(
            this.prisma,
            f.workspaceId,
            p.directionId,
        )
        await this.rbac.assertCanManageDirection(ctx, p.directionId ?? null)
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
                directionId: p.directionId ?? null,
            },
        })
        return serializeAchievement(achievement)
    }
}
