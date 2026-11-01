import type { PublicPricing } from "../../shared/api/pricing"

const RUB = new Intl.NumberFormat("ru-RU")

export const rub = (amount: number) => `${RUB.format(amount)} ₽`

// 1 ученик, 2 ученика, 5 учеников.
export const pluralRu = (n: number, one: string, few: string, many: string) => {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

type Tier = PublicPricing["tiers"][number]

// «до 50 учеников» / «400+ учеников» — tiers arrive sorted by upTo, the
// open-ended one last.
export const tierRange = (tiers: Tier[], index: number): string => {
  const tier = tiers[index]
  if (tier.upTo !== null) return `до ${tier.upTo} ${pluralRu(tier.upTo, "ученика", "учеников", "учеников")}`
  const floor = index > 0 ? (tiers[index - 1].upTo ?? 0) : 0
  return `${floor}+ учеников`
}

// «16 990 ₽ + 35 ₽ за каждого сверх 400» for the open-ended tier.
export const tierPrice = (tiers: Tier[], index: number): string => {
  const tier = tiers[index]
  const floor = index > 0 ? (tiers[index - 1].upTo ?? 0) : 0
  return tier.extraMemberPrice > 0
    ? `${rub(tier.priceMonthly)} + ${rub(tier.extraMemberPrice)} за каждого сверх ${floor}`
    : rub(tier.priceMonthly)
}
