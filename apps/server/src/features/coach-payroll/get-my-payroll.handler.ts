import { Feature, IFeatureHandler } from '@shelfjs/features'

import { loadPayrollClasses } from '../../domains/payroll/payroll-loader'
import { payrollMonthOf, snapshotLine } from '../../domains/payroll/payroll-month'
import { dbDateToMonth } from '../../domains/payroll/payroll-rules'
import { PrismaService } from '../../infrastructure/prisma'
import { isClubAdmin } from '../../shared/access/assert-admin-scope'
import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    GetMyPayrollFeature,
    type GetMyPayrollFeatureResponse,
} from './get-my-payroll.feature'

export const PAY_HIDDEN_MESSAGE = 'Клуб не показывает выплаты в приложении'

// «Мои выплаты»: a staff member's own closed months — only while the club
// shows them (a club admin always may) — and this month's counts, no money.
@Feature(GetMyPayrollFeature)
export class GetMyPayrollHandler
    implements IFeatureHandler<GetMyPayrollFeature, GetMyPayrollFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: GetMyPayrollFeature): Promise<GetMyPayrollFeatureResponse> {
        // Refuses anyone who is not staff.
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { timezone: true, coachPayVisible: true },
        })
        if (!workspace) throw new NotFoundError({ message: 'Клуб не найден' })
        if (!workspace.coachPayVisible && !isClubAdmin(ctx, f)) {
            throw new ForbiddenError({ message: PAY_HIDDEN_MESSAGE })
        }

        const current = payrollMonthOf(new Date(), workspace.timezone)
        const [lines, classes] = await Promise.all([
            this.prisma.payrollLine.findMany({
                where: { workspaceId: f.workspaceId, coachId: f.invokerUserId },
                include: { payrollMonth: { select: { month: true, closedAt: true, currency: true } } },
                orderBy: { payrollMonth: { month: 'desc' } },
                take: 12,
            }),
            loadPayrollClasses(this.prisma, {
                workspaceId: f.workspaceId,
                month: current,
                tz: workspace.timezone,
            }),
        ])
        const adjustments =
            lines.length > 0
                ? await this.prisma.payrollAdjustment.findMany({
                      where: {
                          workspaceId: f.workspaceId,
                          coachId: f.invokerUserId,
                          month: { in: lines.map((l) => l.payrollMonth.month) },
                      },
                      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                  })
                : []
        const own = classes.counted.filter((c) => c.coachId === f.invokerUserId)

        return {
            months: lines.map((l) => {
                const line = snapshotLine(l)
                return {
                    month: dbDateToMonth(l.payrollMonth.month),
                    closedAt: l.payrollMonth.closedAt.toISOString(),
                    currency: l.payrollMonth.currency,
                    rate: line.rate,
                    classes: line.classes,
                    classesPaid: line.classesPaid,
                    marks: line.marks,
                    marksPaid: line.marksPaid,
                    revenueBase: line.revenueBase,
                    amounts: line.amounts,
                    total: line.total,
                    // Only what was paid: one in another currency was left out.
                    adjustments: adjustments
                        .filter(
                            (a) =>
                                a.month.getTime() === l.payrollMonth.month.getTime() &&
                                a.currency === l.payrollMonth.currency,
                        )
                        .map((a) => ({
                            id: a.id,
                            amount: a.amount,
                            comment: a.comment,
                            createdAt: a.createdAt.toISOString(),
                        })),
                }
            }),
            current: {
                month: current,
                classes: own.length,
                marks: own.reduce((sum, c) => sum + c.marks, 0),
            },
        }
    }
}
