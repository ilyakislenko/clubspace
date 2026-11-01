import { Feature, IFeatureHandler } from '@shelfjs/features'

import { directionRefSelect } from '../../domains/directions/direction-ref'
import { assertDirectionInWorkspace } from '../../domains/directions/direction-scope'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { serializeLadder } from './schemas'
import {
    UpdateLadderFeature,
    UpdateLadderFeatureResponse,
} from './update-ladder.feature'

@Feature(UpdateLadderFeature)
export class UpdateLadderHandler
    implements IFeatureHandler<UpdateLadderFeature, UpdateLadderFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: UpdateLadderFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const existing = await this.prisma.rankLadder.findFirst({
            where: { id: f.ladderId, workspaceId: f.workspaceId },
            select: { id: true, directionId: true },
        })
        if (!existing) throw new NotFoundError({ message: 'Лестница рангов не найдена' })

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
        const ladder = await this.prisma.rankLadder.update({
            where: { id: f.ladderId },
            data: {
                ...(p.name !== undefined ? { name: p.name } : {}),
                ...(p.audience !== undefined
                    ? { audience: p.audience ?? null }
                    : {}),
                ...(p.isActive !== undefined ? { isActive: p.isActive } : {}),
                ...(p.order !== undefined ? { order: p.order } : {}),
                ...(p.directionId !== undefined
                    ? { directionId: p.directionId }
                    : {}),
            },
            include: {
                levels: { orderBy: { order: 'asc' } },
                direction: directionRefSelect,
            },
        })
        return serializeLadder(ladder)
    }
}
