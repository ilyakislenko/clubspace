import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    discountApplies,
    priceSale,
    type SaleItem,
} from '../../domains/discounts/discount-rules'
import { countUsesByDiscount } from '../../domains/discounts/discount-uses'
import { discountRuleSelect, toDiscountRule } from '../../domains/discounts/discounts'
import { loadFamilyEligibility } from '../../domains/discounts/family'
import { dbDateToYmd } from '../../domains/subscriptions/freeze-dates'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { localDateInTz } from '../attendance/attendance-utils'
import {
    ListSaleDiscountsFeature,
    type ListSaleDiscountsFeatureResponse,
} from './list-sale-discounts.feature'

// The «Скидка» select of a staff sale (abonement, mark-paid, ticket): every
// active club discount this member may get today, priced per item. Whoever may
// sell to the member may read it (docs/design/2026-11-15-discounts.md §3.3).
@Feature(ListSaleDiscountsFeature)
export class ListSaleDiscountsHandler
    implements IFeatureHandler<ListSaleDiscountsFeature, ListSaleDiscountsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: ListSaleDiscountsFeature): Promise<ListSaleDiscountsFeatureResponse> {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        await this.rbac.assertCanWriteMember(ctx, f.userId)

        const now = new Date()
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { timezone: true },
        })
        const today = localDateInTz(now, workspace?.timezone ?? 'UTC')

        let items: SaleItem[]
        if (f.payload.eventId) {
            const event = await this.prisma.workspaceEvent.findFirst({
                where: { id: f.payload.eventId, workspaceId: f.workspaceId },
                select: { id: true, price: true, currency: true },
            })
            if (!event) throw new NotFoundError({ message: 'Событие не найдено' })
            items =
                event.price === null
                    ? []
                    : [{ planId: null, eventId: event.id, listPrice: event.price, currency: event.currency }]
        } else {
            // The tariffs the caller may sell: an archived one only by whoever
            // assignSubscription lets sell it (canWriteAllGroups — owner,
            // admin, head coach); a coach sees the active ones.
            const plans = await this.prisma.plan.findMany({
                where: {
                    workspaceId: f.workspaceId,
                    ...(this.rbac.canWriteAllGroups(ctx) ? {} : { isActive: true }),
                },
                select: { id: true, price: true, currency: true },
            })
            items = plans.map((p) => ({
                planId: p.id,
                eventId: null,
                listPrice: p.price,
                currency: p.currency,
            }))
        }

        const [rows, familyEligible] = await Promise.all([
            this.prisma.discount.findMany({
                where: { workspaceId: f.workspaceId, isActive: true },
                select: discountRuleSelect,
            }),
            loadFamilyEligibility(this.prisma, {
                workspaceId: f.workspaceId,
                userId: f.userId,
                now,
            }),
        ])
        const rules = rows
            .map(toDiscountRule)
            .filter((d) => !d.isFamily || familyEligible)
        const [clubUses, memberUses] = await Promise.all([
            countUsesByDiscount(
                this.prisma,
                rules.filter((d) => d.maxUses !== null).map((d) => d.id),
            ),
            countUsesByDiscount(
                this.prisma,
                rules.filter((d) => d.oncePerMember).map((d) => d.id),
                f.userId,
            ),
        ])

        const options = rules.flatMap((d) => {
            if (d.maxUses !== null && (clubUses.get(d.id) ?? 0) >= d.maxUses) return []
            if (d.oncePerMember && (memberUses.get(d.id) ?? 0) > 0) return []
            const priced = items
                .filter((item) => discountApplies(d, item, today) === null)
                .map((item) => ({
                    planId: item.planId,
                    eventId: item.eventId,
                    listPrice: item.listPrice,
                    amount: priceSale({ listPrice: item.listPrice, currency: item.currency, discount: d })
                        .amount,
                    currency: item.currency,
                }))
            if (priced.length === 0) return []
            return [
                {
                    discountId: d.id,
                    name: d.name,
                    kind: d.kind,
                    value: d.value,
                    code: d.code,
                    isFamily: d.isFamily,
                    endsOn: d.endsOn ? dbDateToYmd(d.endsOn) : null,
                    items: priced,
                },
            ]
        })
        options.sort(
            (a, b) => Number(b.isFamily) - Number(a.isFamily) || a.name.localeCompare(b.name, 'ru'),
        )
        return { familyEligible, options }
    }
}
