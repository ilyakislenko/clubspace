import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
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
        await assertWorkspaceAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const ladder = await this.prisma.rankLadder.create({
            data: {
                workspaceId: f.workspaceId,
                name: f.payload.name,
                audience: f.payload.audience ?? null,
                order: f.payload.order ?? 0,
            },
            include: { levels: { orderBy: { order: 'asc' } } },
        })
        return serializeLadder(ladder)
    }
}
