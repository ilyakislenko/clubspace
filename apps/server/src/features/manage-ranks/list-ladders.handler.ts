import { Feature, IFeatureHandler } from '@shelfjs/features'

import { directionRefSelect } from '../../domains/directions/direction-ref'
import { PrismaService } from '../../infrastructure/prisma'
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
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const directionIds = await this.rbac.assertManagesDirections(ctx)
        const ladders = await this.prisma.rankLadder.findMany({
            where: {
                workspaceId: f.workspaceId,
                ...(directionIds ? { directionId: { in: directionIds } } : {}),
                ...(f.payload.includeInactive ? {} : { isActive: true }),
            },
            include: {
                levels: { orderBy: { order: 'asc' } },
                direction: directionRefSelect,
            },
            orderBy: [{ order: 'asc' }, { name: 'asc' }],
        })
        return { data: ladders.map(serializeLadder) }
    }
}
