import { Feature, IFeatureHandler } from '@shelfjs/features'

import { assertDirectionInWorkspace } from '../../domains/directions/direction-scope'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
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
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const existing = await this.prisma.plan.findFirst({
            where: { id: f.planId, workspaceId: f.workspaceId },
            select: {
                id: true,
                price: true,
                isFreeTrial: true,
                purchasableOnline: true,
                directionId: true,
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
                ...(p.directionId !== undefined
                    ? { directionId: p.directionId }
                    : {}),
            },
        })
        return serializePlan(plan)
    }
}
