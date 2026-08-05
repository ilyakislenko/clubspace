import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { serializeLevel } from './schemas'
import {
    UpdateLevelFeature,
    UpdateLevelFeatureResponse,
} from './update-level.feature'

@Feature(UpdateLevelFeature)
export class UpdateLevelHandler
    implements IFeatureHandler<UpdateLevelFeature, UpdateLevelFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: UpdateLevelFeature) {
        await assertWorkspaceAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const level = await this.prisma.rankLevel.findFirst({
            where: {
                id: f.levelId,
                ladderId: f.ladderId,
                ladder: { workspaceId: f.workspaceId },
            },
            select: { id: true },
        })
        if (!level) throw new NotFoundError({ message: 'Ранг не найден' })

        const p = f.payload
        const updated = await this.prisma.rankLevel.update({
            where: { id: f.levelId },
            data: {
                ...(p.name !== undefined ? { name: p.name } : {}),
                ...(p.order !== undefined ? { order: p.order } : {}),
                ...(p.color !== undefined ? { color: p.color ?? null } : {}),
                ...(p.maxStripes !== undefined
                    ? { maxStripes: p.maxStripes }
                    : {}),
                ...(p.requirements !== undefined
                    ? { requirements: p.requirements ?? null }
                    : {}),
                ...(p.isActive !== undefined ? { isActive: p.isActive } : {}),
            },
        })
        return serializeLevel(updated)
    }
}
