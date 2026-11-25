import { Feature, IFeatureHandler } from '@shelfjs/features'

import { loadPayrollClasses, loadPayrollCurrency } from '../../domains/payroll/payroll-loader'
import { loadClosedPayrollMonth } from '../../domains/payroll/payroll-month'
import { isPaidClass, type PayrollClass, rateFor } from '../../domains/payroll/payroll-rules'
import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { displayName } from '../attendance/schemas'
import {
    ListPayrollClassesFeature,
    type ListPayrollClassesFeatureResponse,
} from './list-payroll-classes.feature'

const UNASSIGNED_NAME = 'Не распределено'

// The coach panel's «Занятия»: the classes credited to the coach (paid,
// unpaid under the threshold, cancelled after the roster was opened) and
// the classes of their groups someone else ran.
@Feature(ListPayrollClassesFeature)
export class ListPayrollClassesHandler
    implements IFeatureHandler<ListPayrollClassesFeature, ListPayrollClassesFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListPayrollClassesFeature): Promise<ListPayrollClassesFeatureResponse> {
        await assertClubAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { timezone: true },
        })
        if (!workspace) throw new NotFoundError({ message: 'Клуб не найден' })
        const month = f.payload.month
        const [classes, rates, closed, clubCurrency] = await Promise.all([
            loadPayrollClasses(this.prisma, {
                workspaceId: f.workspaceId,
                month,
                tz: workspace.timezone,
            }),
            this.prisma.coachRate.findMany({
                where: { workspaceId: f.workspaceId, coachId: f.coachId },
                select: { effectiveFrom: true, perClassMinStudents: true, currency: true },
            }),
            loadClosedPayrollMonth(this.prisma, f.workspaceId, month),
            loadPayrollCurrency(this.prisma, f.workspaceId),
        ])
        // A rate in another currency than the month's pays nothing (computeLines).
        const inForce = rateFor(rates, month)
        const rate = inForce && inForce.currency === (closed?.currency ?? clubCurrency) ? inForce : null
        const all = [
            ...classes.counted.map((c) => ({ c, cancelled: false })),
            ...classes.cancelled.map((c) => ({ c, cancelled: true })),
        ].sort((a, b) => a.c.startAt.getTime() - b.c.startAt.getTime())
        const own = all.filter((x) => x.c.coachId === f.coachId)
        const byOthers = all.filter(
            (x) => !x.cancelled && x.c.groupPrimaryCoachId === f.coachId && x.c.coachId !== f.coachId,
        )
        const otherIds = [...new Set(byOthers.flatMap((x) => (x.c.coachId ? [x.c.coachId] : [])))]
        const others =
            otherIds.length > 0
                ? await this.prisma.user.findMany({
                      where: { id: { in: otherIds } },
                      select: { id: true, firstname: true, lastname: true, email: true },
                  })
                : []
        const names = new Map(others.map((u) => [u.id, displayName(u)]))
        const item = (c: PayrollClass) => ({
            sessionId: c.sessionId,
            date: c.date,
            startAt: c.startAt.toISOString(),
            groupId: c.groupId,
            groupName: c.groupName,
            marks: c.marks,
        })
        const items = [
            ...own.map((x) => ({
                ...item(x.c),
                status: x.cancelled
                    ? ('cancelled' as const)
                    : isPaidClass(x.c.marks, rate)
                      ? ('paid' as const)
                      : ('unpaid' as const),
                substitute: !x.c.groupCoachIds.includes(f.coachId),
                ranBy: null,
            })),
            ...byOthers.map((x) => ({
                ...item(x.c),
                status: 'other_coach' as const,
                substitute: false,
                ranBy: {
                    coachId: x.c.coachId,
                    name: x.c.coachId ? (names.get(x.c.coachId) ?? UNASSIGNED_NAME) : UNASSIGNED_NAME,
                },
            })),
        ].sort((a, b) => a.startAt.localeCompare(b.startAt) || a.sessionId.localeCompare(b.sessionId))
        return { month, coachId: f.coachId, items }
    }
}
