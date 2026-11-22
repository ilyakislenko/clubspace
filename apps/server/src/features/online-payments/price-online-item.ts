import {
    discountApplies,
    type DiscountRefusalReason,
    type DiscountRule,
    normalizePromoCode,
    type PricedSale,
    priceSale,
    type SaleItem,
} from '../../domains/discounts/discount-rules'
import { countDiscountUses } from '../../domains/discounts/discount-uses'
import {
    discountRuleSelect,
    resolveAutomaticDiscount,
    toDiscountRule,
} from '../../domains/discounts/discounts'
import { dbDateToYmd } from '../../domains/subscriptions/freeze-dates'
import type { PrismaTransactionClientType } from '../../infrastructure/prisma'

type Db = Pick<
    PrismaTransactionClientType,
    'discount' | 'guardianship' | 'subscription' | 'eventRegistration' | 'payment' | 'workspace'
>

export const FAMILY_WINS_NOTE = 'Семейная скидка выгоднее — она уже учтена'
export const PROMO_ZERO_NOTE = 'С промокодом выходит 0 ₽ — оформите покупку в клубе'
const ZERO_MESSAGE = 'Со скидкой выходит 0 ₽ — оформите покупку в клубе'

// Why a code that was found can't price this item, as the member reads it.
const promoRefusalNote = (reason: DiscountRefusalReason, item: SaleItem): string => {
    if (reason === 'expired') return 'Срок действия промокода закончился'
    if (reason === 'scheduled') return 'Промокод ещё не действует'
    if (reason === 'archived') return 'Промокод не найден'
    return `Промокод не действует на ${item.eventId ? 'это событие' : 'этот тариф'}`
}

export type OnlinePrice = PricedSale & {
    listPrice: number
    currency: string
    // The discount in the price, as the checkout shows it before paying.
    discount: { name: string; code: string | null; isFamily: boolean; endsOn: string | null } | null
    // Why the promo code didn't change the price (null: none sent, or it did).
    promoCodeNote: string | null
    // The checkout refuses with this text: the code can't be used (every note
    // but «family wins»), or the price comes out at 0 ₽. null = it may charge.
    refusal: string | null
}

// The member's online price of one item (docs/design/2026-11-15-discounts.md
// §3.3), shared by the quote and both checkouts so they charge exactly what
// was quoted: the family discount (resolveAutomaticDiscount) against the
// promo code's (discountApplies, then oncePerMember / maxUses with the open
// checkouts counted — except `excludePaymentId`, the member's own payment the
// checkout would reuse); the larger saving wins, a tie goes to family (no use
// consumed). `today` = the club-local day.
export const priceOnlineItem = async (
    db: Db,
    p: {
        workspaceId: string
        userId: string
        item: SaleItem
        promoCode: string | undefined
        now: Date
        today: string
        excludePaymentId?: string
    },
): Promise<OnlinePrice> => {
    const family = await resolveAutomaticDiscount(db, {
        workspaceId: p.workspaceId,
        userId: p.userId,
        item: p.item,
        now: p.now,
        today: p.today,
    })
    const promo = p.promoCode?.trim() ? await resolvePromo(db, p) : null

    const familyPrice = priceSale({ listPrice: p.item.listPrice, currency: p.item.currency, discount: family })
    let applied: DiscountRule | null = family
    let priced = familyPrice
    let note = promo && 'note' in promo ? promo.note : null
    if (promo && 'rule' in promo) {
        const promoPrice = priceSale({
            listPrice: p.item.listPrice,
            currency: p.item.currency,
            discount: promo.rule,
        })
        if (promoPrice.amount < 1) {
            note = PROMO_ZERO_NOTE
        } else if (family && familyPrice.discountAmount >= promoPrice.discountAmount) {
            note = FAMILY_WINS_NOTE
        } else {
            applied = promo.rule
            priced = promoPrice
        }
    }
    const refusal =
        note && note !== FAMILY_WINS_NOTE ? note : priced.amount < 1 ? ZERO_MESSAGE : null
    return {
        ...priced,
        listPrice: p.item.listPrice,
        currency: p.item.currency,
        discount: applied
            ? {
                  name: applied.name,
                  code: applied.code,
                  isFamily: applied.isFamily,
                  endsOn: applied.endsOn ? dbDateToYmd(applied.endsOn) : null,
              }
            : null,
        promoCodeNote: note,
        refusal,
    }
}

// The club's active discount with this code that this member may use now, or
// the note why not. Archived codes are «не найден».
const resolvePromo = async (
    db: Db,
    p: {
        workspaceId: string
        userId: string
        item: SaleItem
        promoCode: string | undefined
        now: Date
        today: string
        excludePaymentId?: string
    },
): Promise<{ rule: DiscountRule } | { note: string }> => {
    const code = normalizePromoCode(p.promoCode ?? '')
    const row = code
        ? await db.discount.findFirst({
              where: { workspaceId: p.workspaceId, code, isActive: true },
              select: discountRuleSelect,
          })
        : null
    if (!row) return { note: 'Промокод не найден' }
    const rule = toDiscountRule(row)
    const refused = discountApplies(rule, p.item, p.today)
    if (refused) return { note: promoRefusalNote(refused.reason, p.item) }
    const includePending = { now: p.now, excludePaymentId: p.excludePaymentId }
    if (
        rule.oncePerMember &&
        (await countDiscountUses(db, rule.id, { userId: p.userId, includePending })) > 0
    ) {
        return { note: 'Вы уже использовали этот промокод' }
    }
    if (rule.maxUses !== null && (await countDiscountUses(db, rule.id, { includePending })) >= rule.maxUses) {
        return { note: 'Промокоды по этой акции закончились' }
    }
    return { rule }
}
