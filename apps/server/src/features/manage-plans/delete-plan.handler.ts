import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    DeletePlanFeature,
    DeletePlanFeatureResponse,
} from './delete-plan.feature'

@Feature(DeletePlanFeature)
export class DeletePlanHandler
    implements IFeatureHandler<DeletePlanFeature, DeletePlanFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: DeletePlanFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const plan = await this.prisma.plan.findFirst({
            where: { id: f.planId, workspaceId: f.workspaceId },
            select: {
                id: true,
                directions: { select: { directionId: true } },
                _count: { select: { subscriptions: true } },
            },
        })
        if (!plan) throw new NotFoundError({ message: 'Тариф не найден' })
        const scope = plan.directions.map((d) => d.directionId)
        // Every direction of the set; a club-wide tariff is admin-only.
        await this.rbac.assertCanManageDirection(
            ctx,
            ...(scope.length > 0 ? scope : [null]),
        )

        // Preserve purchase history: a referenced tariff can't be hard-deleted;
        // archive it (isActive=false) via update-plan instead.
        if (plan._count.subscriptions > 0) {
            throw new BadRequestError({
                message:
                    'По тарифу есть абонементы — его нельзя удалить, отправьте в архив',
            })
        }
        await this.prisma.plan.delete({ where: { id: plan.id } })
        return { status: 'deleted' as const }
    }
}
