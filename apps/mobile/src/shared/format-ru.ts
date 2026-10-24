// Russian plural form: one → 1, 21; few → 2–4, 22–24; many → 0, 5–20, 25…
export const pluralRu = (
  n: number,
  one: string,
  few: string,
  many: string,
): string => {
  const last = Math.abs(n) % 10
  const last2 = Math.abs(n) % 100
  if (last2 >= 11 && last2 <= 14) return many
  if (last === 1) return one
  if (last >= 2 && last <= 4) return few
  return many
}

// Hand-rolled instead of Intl.NumberFormat({ style: "currency" }): Hermes'
// currency support differs between iOS/Android/web, and a wrong symbol on a
// payment line is worse than a plain one. Narrow no-break space between thousands.
export const formatMoney = (amount: number, currency: string): string => {
  const fixed = Number.isInteger(amount) ? String(amount) : amount.toFixed(2)
  const [int, frac] = fixed.split(".")
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, "\u202F")
  const symbol = currency === "RUB" ? "₽" : currency
  return `${grouped}${frac ? `,${frac}` : ""}\u00A0${symbol}`
}

// Month names, index 0 = January. Nominative for headings, prepositional for «в октябре».
export const MONTHS_RU = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
] as const

export const MONTHS_IN_RU = [
  "январе",
  "феврале",
  "марте",
  "апреле",
  "мае",
  "июне",
  "июле",
  "августе",
  "сентябре",
  "октябре",
  "ноябре",
  "декабре",
] as const

// Genitive, for a day: «5 октября».
export const MONTHS_OF_RU = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
] as const
