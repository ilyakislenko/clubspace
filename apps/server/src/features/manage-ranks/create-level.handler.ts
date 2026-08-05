import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    CreateLevelFeature,
    CreateLevelFeatureResponse,
} from './create-level.feature'
import { serializeLevel } from './schemas'

@Feature(CreateLevelFeature)
export class CreateLevelHandler
    implements IFeatureHandler<CreateLevelFeature, CreateLevelFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: CreateLevelFeature) {
        await assertWorkspaceAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const ladder = await this.prisma.rankLadder.findFirst({
            where: { id: f.ladderId, workspaceId: f.workspaceId },
            select: { id: true },
        })
        if (!ladder) throw new NotFoundError({ message: 'Лестница рангов не найдена' })

        const level = await this.prisma.rankLevel.create({
            data: {
                ladderId: f.ladderId,
                name: f.payload.name,
                order: f.payload.order,
                color: f.payload.color ?? null,
                maxStripes: f.payload.maxStripes ?? 0,
                requirements: f.payload.requirements ?? null,
            },
        })
        return serializeLevel(level)
    }
}
