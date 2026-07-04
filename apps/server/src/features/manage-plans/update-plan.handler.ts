import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import { serializePlan } from './schemas'
import {
    UpdatePlanFeature,
    UpdatePlanFeatureResponse,
} from './update-plan.feature'

@Feature(UpdatePlanFeature)
export class UpdatePlanHandler
    implements IFeatureHandler<UpdatePlanFeature, UpdatePlanFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: UpdatePlanFeature) {
        await assertWorkspaceAdmin(
            this.rbac,
            {
                userId: f.invokerUserId,
                workspaceId: f.workspaceId,
                roleName: f.roleName,
                isSuperAdmin: f.isSuperAdmin,
            },
            'Only workspace admins can manage tariffs',
        )
        const existing = await this.prisma.plan.findFirst({
            where: { id: f.planId, workspaceId: f.workspaceId },
            select: { id: true },
        })
        if (!existing) throw new NotFoundError({ message: 'Plan not found' })

        const p = f.payload
        const plan = await this.prisma.plan.update({
            where: { id: f.planId },
            data: {
                ...(p.name !== undefined ? { name: p.name } : {}),
                ...(p.description !== undefined
                    ? { description: p.description ?? null }
                    : {}),
                ...(p.price !== undefined ? { price: p.price } : {}),
                ...(p.currency !== undefined
                    ? { currency: p.currency.toUpperCase() }
                    : {}),
                ...(p.durationDays !== undefined
                    ? { durationDays: p.durationDays }
                    : {}),
                ...(p.isActive !== undefined ? { isActive: p.isActive } : {}),
            },
        })
        return serializePlan(plan)
    }
}
