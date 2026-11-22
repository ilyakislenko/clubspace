import { Feature, IFeatureHandler } from '@shelfjs/features'

import { resolveJournalPeriod } from '../../domains/payments/journal'
import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { RbacService } from '../../shared/services/rbac.service'
import { loadStaffDiscountSummary } from './discount-staff-summary'
import { loadClubToday, loadDiscountStats } from './discount-store'
import {
    ListDiscountsFeature,
    type ListDiscountsFeatureResponse,
} from './list-discounts.feature'
import { DISCOUNT_LIST_LIMIT, discountDtoSelect, serializeDiscount } from './schemas'

// «Абонементы → Скидки»: the club's discounts with their usage, and who gave
// how much in the period. Club money: owner and admins only.
@Feature(ListDiscountsFeature)
export class ListDiscountsHandler
    implements IFeatureHandler<ListDiscountsFeature, ListDiscountsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListDiscountsFeature): Promise<ListDiscountsFeatureResponse> {
        await assertClubAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const now = new Date()
        const { today, timezone } = await loadClubToday(this.prisma, f.workspaceId, now)
        const period = resolveJournalPeriod(f.payload, timezone, now)
        const rows = await this.prisma.discount.findMany({
            where: {
                workspaceId: f.workspaceId,
                ...(f.payload.archived ? {} : { isActive: true }),
            },
            select: discountDtoSelect,
            orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
            take: DISCOUNT_LIST_LIMIT,
        })
        const [stats, byStaff] = await Promise.all([
            loadDiscountStats(
                this.prisma,
                rows.map((r) => r.id),
            ),
            loadStaffDiscountSummary(this.prisma, f.workspaceId, period.range),
        ])
        return {
            data: rows.map((r) =>
                serializeDiscount(r, stats.get(r.id) ?? { uses: 0, given: [] }, today),
            ),
            byStaff,
        }
    }
}
