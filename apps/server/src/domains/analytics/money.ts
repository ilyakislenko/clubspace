const NUMBER = new Intl.NumberFormat('ru-RU')
const SYMBOLS: Record<string, string> = { RUB: '₽', USD: '$', EUR: '€', KZT: '₸' }

// «5 000 ₽» for analytics copy (reasons, digest). Amounts are whole units of
// the abonement's currency, like Plan.price.
export const formatMoney = (amount: number, currency: string | null): string =>
    `${NUMBER.format(amount)} ${SYMBOLS[currency ?? 'RUB'] ?? currency}`
