import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { BadRequestError, NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    DeleteDiscountFeature,
    type DeleteDiscountFeatureResponse,
} from './delete-discount.feature'
import { DISCOUNT_USED_MESSAGE, discountAuditFields, discountDtoSelect } from './schemas'

// A discount nobody used yet is deleted; a used one is archived instead —
// sales and payments reference it (FK Restrict backs the check).
@Feature(DeleteDiscountFeature)
export class DeleteDiscountHandler
    implements IFeatureHandler<DeleteDiscountFeature, DeleteDiscountFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: DeleteDiscountFeature): Promise<DeleteDiscountFeatureResponse> {
        await assertClubAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const row = await this.prisma.discount.findFirst({
            where: { id: f.discountId, workspaceId: f.workspaceId },
            select: discountDtoSelect,
        })
        if (!row) throw new NotFoundError({ message: 'Скидка не найдена' })

        // Any row carrying it — a cancelled unpaid sale too (not a use, but it
        // still references the discount).
        const [subs, tickets, payments] = await Promise.all([
            this.prisma.subscription.count({ where: { discountId: row.id } }),
            this.prisma.eventRegistration.count({ where: { discountId: row.id } }),
            this.prisma.payment.count({ where: { discountId: row.id } }),
        ])
        if (subs + tickets + payments > 0) {
            throw new BadRequestError({ message: DISCOUNT_USED_MESSAGE })
        }
        try {
            await this.prisma.discount.delete({ where: { id: row.id } })
        } catch (e) {
            // A sale referencing it landed after the check.
            if ((e as { code?: string } | null)?.code === 'P2003') {
                throw new BadRequestError({ message: DISCOUNT_USED_MESSAGE })
            }
            throw e
        }

        await this.audit.record({
            action: 'discount.delete',
            targetType: 'discount',
            targetId: row.id,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: discountAuditFields(row),
        })
        this.realtime.invalidate(f.workspaceId, ['discounts'])
        return { status: 'deleted' }
    }
}
