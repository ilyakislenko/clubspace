import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { loadPayrollCurrency } from '../../domains/payroll/payroll-loader'
import { lockPayroll } from '../../domains/payroll/payroll-lock'
import { dbDateToMonth, monthToDbDate, rateValues } from '../../domains/payroll/payroll-rules'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { BadRequestError, ConflictError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { claimUnchanged } from '../../shared/utils/optimistic-concurrency'
import { coachCandidatesWhere } from '../class-substitutions/class-substitution-access'
import {
    SetCoachRateFeature,
    type SetCoachRateFeatureResponse,
} from './set-coach-rate.feature'

export const NOT_STAFF_MESSAGE = 'Это не сотрудник клуба'

export const serializeCoachRate = (r: {
    id: string
    coachId: string
    effectiveFrom: Date
    fixedMonthly: number
    perClass: number
    perClassMinStudents: number
    perStudent: number
    revenueBp: number
    currency: string
    updatedAt: Date
}): SetCoachRateFeatureResponse => ({
    id: r.id,
    coachId: r.coachId,
    ...rateValues(r),
    updatedAt: r.updatedAt.toISOString(),
})

// «Изменить ставку»: the rate from a month on. A month already closed at or
// after it would change frozen pay, so it is refused; earlier months keep
// their own rate.
@Feature(SetCoachRateFeature)
export class SetCoachRateHandler
    implements IFeatureHandler<SetCoachRateFeature, SetCoachRateFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: SetCoachRateFeature): Promise<SetCoachRateFeatureResponse> {
        const ctx = await assertClubAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const coach = await this.prisma.user.findFirst({
            where: { id: f.coachId, ...coachCandidatesWhere(f.workspaceId, ctx.workspaceOwnerId) },
            select: { id: true },
        })
        if (!coach) throw new BadRequestError({ message: NOT_STAFF_MESSAGE })

        const p = f.payload
        const currency = await loadPayrollCurrency(this.prisma, f.workspaceId)
        const effectiveFrom = monthToDbDate(p.effectiveFrom)
        const values = {
            fixedMonthly: p.fixedMonthly,
            perClass: p.perClass,
            perClassMinStudents: p.perClassMinStudents,
            perStudent: p.perStudent,
            revenueBp: p.revenueBp,
            currency,
            updatedById: f.invokerUserId,
        }
        // Under the payroll lock no other payroll write interleaves, so the
        // existing row is read before writing instead of catching P2002 (an
        // error would abort the transaction).
        const { before, row } = await this.prisma.$transaction(async (tx) => {
            await lockPayroll(tx, f.workspaceId)
            const closed = await tx.payrollMonth.findFirst({
                where: { workspaceId: f.workspaceId, month: { gte: effectiveFrom } },
                orderBy: { month: 'desc' },
                select: { month: true },
            })
            if (closed) {
                throw new ConflictError({
                    message: `Месяц ${dbDateToMonth(closed.month)} закрыт — ставка может действовать только с месяца после него`,
                })
            }
            // The form's version is the coach's newest rate change.
            await claimUnchanged(p.expectedUpdatedAt, async (expected) => ({
                count:
                    (await tx.coachRate.count({
                        where: {
                            workspaceId: f.workspaceId,
                            coachId: f.coachId,
                            updatedAt: { gt: expected },
                        },
                    })) === 0
                        ? 1
                        : 0,
            }))
            const existing = await tx.coachRate.findUnique({
                where: {
                    workspaceId_coachId_effectiveFrom: {
                        workspaceId: f.workspaceId,
                        coachId: f.coachId,
                        effectiveFrom,
                    },
                },
            })
            const written = existing
                ? await tx.coachRate.update({ where: { id: existing.id }, data: values })
                : await tx.coachRate.create({
                      data: {
                          workspaceId: f.workspaceId,
                          coachId: f.coachId,
                          effectiveFrom,
                          ...values,
                      },
                  })
            return { before: existing, row: written }
        })

        await this.audit.record({
            action: 'payroll.setRate',
            targetType: 'payroll',
            targetId: f.coachId,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: {
                coachId: f.coachId,
                effectiveFrom: p.effectiveFrom,
                before: before ? rateValues(before) : null,
                after: rateValues(row),
            },
        })
        this.realtime.invalidate(f.workspaceId, ['payroll'])
        return serializeCoachRate(row)
    }
}
