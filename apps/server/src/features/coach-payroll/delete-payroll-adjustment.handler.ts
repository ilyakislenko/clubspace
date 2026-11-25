import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { assertMonthOpen } from '../../domains/payroll/payroll-lock'
import { dbDateToMonth } from '../../domains/payroll/payroll-rules'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    DeletePayrollAdjustmentFeature,
    type DeletePayrollAdjustmentFeatureResponse,
} from './delete-payroll-adjustment.feature'

// Removes an adjustment of an open month.
@Feature(DeletePayrollAdjustmentFeature)
export class DeletePayrollAdjustmentHandler
    implements
        IFeatureHandler<DeletePayrollAdjustmentFeature, DeletePayrollAdjustmentFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(
        f: DeletePayrollAdjustmentFeature,
    ): Promise<DeletePayrollAdjustmentFeatureResponse> {
        await assertClubAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const row = await this.prisma.payrollAdjustment.findFirst({
            where: { id: f.adjustmentId, workspaceId: f.workspaceId },
        })
        if (!row) throw new NotFoundError({ message: 'Корректировка не найдена' })
        const month = dbDateToMonth(row.month)
        await this.prisma.$transaction(async (tx) => {
            await assertMonthOpen(tx, f.workspaceId, month)
            await tx.payrollAdjustment.deleteMany({
                where: { id: row.id, workspaceId: f.workspaceId },
            })
        })

        await this.audit.record({
            action: 'payroll.deleteAdjustment',
            targetType: 'payroll',
            targetId: row.id,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: { month, coachId: row.coachId, amount: row.amount, comment: row.comment },
        })
        this.realtime.invalidate(f.workspaceId, ['payroll'])
        return { status: 'deleted' }
    }
}
