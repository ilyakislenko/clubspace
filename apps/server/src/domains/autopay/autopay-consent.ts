import { formatMoney } from '../analytics/money'

// The autopay consent the member reads under «Продлевать автоматически»
// (docs/design/2026-11-15-member-autopay.md §2.3). One source: the server
// returns the lines in the purchase options and the checkout quote, the app
// renders them verbatim, and the checkout records the version shown. Changing
// a word means a new version here and a new edition of /legal/autopay
// (apps/client/src/features/legal/autopay, keyed by this version).
// Черновик — требует проверки юристом (design §14).
export const AUTOPAY_CONSENT_VERSION = '2026-11-15'

export const autopayConsentLines = (p: {
    clubName: string
    planName: string
    // What the checkout charges now (a promo code included).
    amountNow: number
    // What each renewal charges (automatic discounts only) — termsAmount.
    renewalAmount: number
    currency: string
    // null: a term; a number: a class pack.
    classCount: number | null
}): string[] => [
    `Сейчас спишем ${formatMoney(p.amountNow, p.currency)}.`,
    `Дальше клуб «${p.clubName}» будет списывать ${formatMoney(p.renewalAmount, p.currency)} с этой карты за каждый следующий абонемент «${p.planName}»: ${
        p.classCount === null
            ? 'за день до окончания срока'
            : 'когда закончатся занятия или срок'
    }.`,
    'За 3 дня до списания пришлём напоминание.',
    'Отключить автоплатёж можно в любой момент в разделе «Мой абонемент» — следующих списаний не будет.',
    'Если клуб изменит цену или условия тарифа, спишем новую сумму только после вашего подтверждения.',
    'Данные карты хранит ЮKassa, клуб и ClubSpace их не видят.',
]
