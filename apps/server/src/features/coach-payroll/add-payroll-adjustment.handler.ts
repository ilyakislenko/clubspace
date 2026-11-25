import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { loadPayrollCurrency } from '../../domains/payroll/payroll-loader'
import { assertMonthOpen } from '../../domains/payroll/payroll-lock'
import { monthToDbDate } from '../../domains/payroll/payroll-rules'
import { shiftMonth } from '../../domains/metrics/revenue'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { coachCandidatesWhere } from '../class-substitutions/class-substitution-access'
import {
    AddPayrollAdjustmentFeature,
    type AddPayrollAdjustmentFeatureResponse,
} from './add-payroll-adjustment.feature'
import { loadActorName, serializePayrollAdjustment } from './schemas'
import { NOT_STAFF_MESSAGE } from './set-coach-rate.handler'

// «Добавить корректировку»: a bonus or deduction with a comment, for a coach
// on staff or one who ran a class that month (a former coach's last month).
@Feature(AddPayrollAdjustmentFeature)
export class AddPayrollAdjustmentHandler
    implements IFeatureHandler<AddPayrollAdjustmentFeature, AddPayrollAdjustmentFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: AddPayrollAdjustmentFeature): Promise<AddPayrollAdjustmentFeatureResponse> {
        const ctx = await assertClubAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const p = f.payload
        const month = monthToDbDate(p.month)
        const coach = await this.prisma.user.findFirst({
            where: {
                id: p.coachId,
                OR: [
                    ...coachCandidatesWhere(f.workspaceId, ctx.workspaceOwnerId).OR,
                    {
                        sessionsCoached: {
                            some: {
                                workspaceId: f.workspaceId,
                                sessionDate: { gte: month, lt: monthToDbDate(shiftMonth(p.month, 1)) },
                            },
                        },
                    },
                ],
            },
            select: { id: true },
        })
        if (!coach) throw new BadRequestError({ message: NOT_STAFF_MESSAGE })

        const [createdByName, currency] = await Promise.all([
            loadActorName(this.prisma, f.invokerUserId),
            loadPayrollCurrency(this.prisma, f.workspaceId),
        ])
        const row = await this.prisma.$transaction(async (tx) => {
            await assertMonthOpen(tx, f.workspaceId, p.month)
            return tx.payrollAdjustment.create({
                data: {
                    workspaceId: f.workspaceId,
                    month,
                    coachId: p.coachId,
                    amount: p.amount,
                    currency,
                    comment: p.comment,
                    createdById: f.invokerUserId,
                    createdByName,
                },
            })
        })

        await this.audit.record({
            action: 'payroll.addAdjustment',
            targetType: 'payroll',
            targetId: row.id,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: { month: p.month, coachId: p.coachId, amount: row.amount, comment: row.comment },
        })
        this.realtime.invalidate(f.workspaceId, ['payroll'])
        return { ...serializePayrollAdjustment(row), month: p.month, coachId: row.coachId }
    }
}
