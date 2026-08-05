import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
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
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            'Управлять тарифами может только администратор клуба',
        )
        const plans = await this.prisma.plan.findMany({
            where: {
                workspaceId: f.workspaceId,
                ...(f.payload.includeInactive ? {} : { isActive: true }),
            },
            orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        })
        return { data: plans.map(serializePlan) }
    }
}
