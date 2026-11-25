import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { lockPayroll } from '../../domains/payroll/payroll-lock'
import { computePayrollMonth, loadClosedPayrollMonth } from '../../domains/payroll/payroll-month'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { ConflictError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    ReopenPayrollMonthFeature,
    type ReopenPayrollMonthFeatureResponse,
} from './reopen-payroll-month.feature'
import { parseMonthParam, serializePayrollMonth } from './schemas'

// «Открыть заново»: drops the frozen month (its lines go with it; the
// adjustments stay). The audit keeps the reason and the totals dropped.
@Feature(ReopenPayrollMonthFeature)
export class ReopenPayrollMonthHandler
    implements IFeatureHandler<ReopenPayrollMonthFeature, ReopenPayrollMonthFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: ReopenPayrollMonthFeature): Promise<ReopenPayrollMonthFeatureResponse> {
        const month = parseMonthParam(f.month)
        await assertClubAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const closed = await this.prisma.$transaction(async (tx) => {
            await lockPayroll(tx, f.workspaceId)
            const row = await loadClosedPayrollMonth(tx, f.workspaceId, month)
            if (!row) throw new ConflictError({ message: 'Месяц не закрыт' })
            await tx.payrollMonth.delete({ where: { id: row.id } })
            return row
        })

        await this.audit.record({
            action: 'payroll.reopenMonth',
            targetType: 'payroll',
            targetId: closed.id,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: {
                month,
                reason: f.payload.reason,
                totalBefore: closed.total,
                currency: closed.currency,
                lines: closed.lines.map((l) => ({
                    coachId: l.coachId,
                    name: l.coachName,
                    total: l.total,
                })),
            },
        })
        this.realtime.invalidate(f.workspaceId, ['payroll'])
        return serializePayrollMonth(
            await computePayrollMonth(this.prisma, {
                workspaceId: f.workspaceId,
                month,
                now: new Date(),
            }),
        )
    }
}
