import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope'
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
        const plan = await this.prisma.plan.findFirst({
            where: { id: f.planId, workspaceId: f.workspaceId },
            select: { id: true, _count: { select: { subscriptions: true } } },
        })
        if (!plan) throw new NotFoundError({ message: 'Тариф не найден' })

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
