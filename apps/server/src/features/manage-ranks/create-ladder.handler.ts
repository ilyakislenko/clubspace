import { Feature, IFeatureHandler } from '@shelfjs/features'

import { directionRefSelect } from '../../domains/directions/direction-ref'
import { assertDirectionInWorkspace } from '../../domains/directions/direction-scope'
import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import {
    CreateLadderFeature,
    CreateLadderFeatureResponse,
} from './create-ladder.feature'
import { serializeLadder } from './schemas'

@Feature(CreateLadderFeature)
export class CreateLadderHandler
    implements IFeatureHandler<CreateLadderFeature, CreateLadderFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: CreateLadderFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        await assertDirectionInWorkspace(
            this.prisma,
            f.workspaceId,
            f.payload.directionId,
        )
        await this.rbac.assertCanManageDirection(
            ctx,
            f.payload.directionId ?? null,
        )
        const ladder = await this.prisma.rankLadder.create({
            data: {
                workspaceId: f.workspaceId,
                name: f.payload.name,
                audience: f.payload.audience ?? null,
                order: f.payload.order ?? 0,
                directionId: f.payload.directionId ?? null,
            },
            include: {
                levels: { orderBy: { order: 'asc' } },
                direction: directionRefSelect,
            },
        })
        return serializeLadder(ladder)
    }
}
