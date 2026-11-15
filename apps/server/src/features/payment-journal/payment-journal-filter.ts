import { resolveAnalyticsScope } from '../../domains/analytics/analytics-scope'
import { type JournalFilter, resolveJournalPeriod } from '../../domains/payments/journal'
import type { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import type { RbacService } from '../../shared/services/rbac.service'
import type { PaymentJournalFilter } from './schemas'

// The journal view the request asks for, as the list and the CSV read it:
// the period in the club's time zone (no dates = the `revenue_30d` window)
// and the analytics scope (an id from another club is a 404, a discount's
// too). `from`/`to` are the club-local days the view covers, `tz` the club's
// time zone.
export const resolvePaymentJournalFilter = async (
    prisma: PrismaService,
    rbac: RbacService,
    caller: { workspaceId: string; invokerUserId: string; roleName: string | null; isSuperAdmin: boolean },
    payload: PaymentJournalFilter,
    now: Date,
): Promise<{ filter: JournalFilter; from: string; to: string; tz: string }> => {
    const workspace = await prisma.workspace.findUnique({
        where: { id: caller.workspaceId },
        select: { timezone: true },
    })
    const tz = workspace?.timezone ?? 'UTC'
    const period = resolveJournalPeriod(payload, tz, now)
    const { scope } = await resolveAnalyticsScope(prisma, rbac, caller, {
        gymId: payload.gymId,
        directionId: payload.directionId,
        groupId: payload.groupId,
        coachId: payload.coachId,
    })
    if (payload.discountId) {
        const discount = await prisma.discount.findFirst({
            where: { id: payload.discountId, workspaceId: caller.workspaceId },
            select: { id: true },
        })
        if (!discount) throw new NotFoundError({ message: 'Скидка не найдена' })
    }
    return {
        filter: {
            workspaceId: caller.workspaceId,
            range: period.range,
            method: payload.method,
            kind: payload.kind,
            markedById: payload.markedById,
            scope,
            q: payload.q || undefined,
            discounted: payload.discounted,
            discountId: payload.discountId,
            pricedById: payload.pricedById,
        },
        from: period.from,
        tz,
        to: period.to,
    }
}
