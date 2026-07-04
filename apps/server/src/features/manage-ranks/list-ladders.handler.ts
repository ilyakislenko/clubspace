import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ListLaddersFeature,
    ListLaddersFeatureResponse,
} from './list-ladders.feature'
import { serializeLadder } from './schemas'

@Feature(ListLaddersFeature)
export class ListLaddersHandler
    implements IFeatureHandler<ListLaddersFeature, ListLaddersFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListLaddersFeature) {
        await assertWorkspaceAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const ladders = await this.prisma.rankLadder.findMany({
            where: {
                workspaceId: f.workspaceId,
                ...(f.payload.includeInactive ? {} : { isActive: true }),
            },
            include: { levels: { orderBy: { order: 'asc' } } },
            orderBy: [{ order: 'asc' }, { name: 'asc' }],
        })
        return { data: ladders.map(serializeLadder) }
    }
}
