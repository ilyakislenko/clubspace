import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ListPlansFeature,
    ListPlansFeatureResponse,
} from './list-plans.feature'
import { serializePlan } from './schemas'

@Feature(ListPlansFeature)
export class ListPlansHandler
    implements IFeatureHandler<ListPlansFeature, ListPlansFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListPlansFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        // Archived tariffs are the admin's catalogue view; a coach only picks
        // from sellable ones.
        const includeInactive =
            f.payload.includeInactive && this.rbac.canWriteAllGroups(ctx)
        const plans = await this.prisma.plan.findMany({
            where: {
                workspaceId: f.workspaceId,
                ...(includeInactive ? {} : { isActive: true }),
            },
            orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        })
        return { data: plans.map(serializePlan) }
    }
}
