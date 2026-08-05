import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    CreatePlanFeature,
    CreatePlanFeatureResponse,
} from './create-plan.feature'
import { serializePlan } from './schemas'

@Feature(CreatePlanFeature)
export class CreatePlanHandler
    implements IFeatureHandler<CreatePlanFeature, CreatePlanFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: CreatePlanFeature) {
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
        const plan = await this.prisma.plan.create({
            data: {
                workspaceId: f.workspaceId,
                name: f.payload.name,
                description: f.payload.description ?? null,
                price: f.payload.price,
                currency: f.payload.currency.toUpperCase(),
                durationDays: f.payload.durationDays,
                classCount: f.payload.classCount ?? null,
                isFreeTrial: f.payload.isFreeTrial ?? false,
                isActive: f.payload.isActive ?? true,
            },
        })
        return serializePlan(plan)
    }
}
