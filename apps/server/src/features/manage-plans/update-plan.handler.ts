import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import {
    canSellOnline,
    ONLINE_FREE_PLAN_MESSAGE,
    serializePlan,
} from './schemas'
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
            'Управлять тарифами может только администратор клуба',
        )
        const existing = await this.prisma.plan.findFirst({
            where: { id: f.planId, workspaceId: f.workspaceId },
            select: {
                id: true,
                price: true,
                isFreeTrial: true,
                purchasableOnline: true,
            },
        })
        if (!existing) throw new NotFoundError({ message: 'Тариф не найден' })

        const p = f.payload
        if (
            (p.purchasableOnline ?? existing.purchasableOnline) &&
            !canSellOnline({
                price: p.price ?? existing.price,
                isFreeTrial: p.isFreeTrial ?? existing.isFreeTrial,
            })
        ) {
            throw new BadRequestError({ message: ONLINE_FREE_PLAN_MESSAGE })
        }
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
                ...(p.classCount !== undefined
                    ? { classCount: p.classCount }
                    : {}),
                ...(p.isFreeTrial !== undefined
                    ? { isFreeTrial: p.isFreeTrial }
                    : {}),
                ...(p.startsOnFirstVisit !== undefined
                    ? { startsOnFirstVisit: p.startsOnFirstVisit }
                    : {}),
                ...(p.isActive !== undefined ? { isActive: p.isActive } : {}),
                ...(p.purchasableOnline !== undefined
                    ? { purchasableOnline: p.purchasableOnline }
                    : {}),
            },
        })
        return serializePlan(plan)
    }
}
