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

// A calendar date ("YYYY-MM-DD", no time, no zone) as «30 октября». Hand-rolled
// for the same reason as formatMoney, and because `new Date("2026-10-30")` is
// UTC midnight — local formatting shows the previous day west of UTC.
export const formatRuDay = (ymd: string): string => {
  const [, m, d] = ymd.split("-").map(Number)
  return `${d} ${MONTHS_OF_RU[m - 1]}`
}

// «с 24 по 30 октября» within a month, «с 28 октября по 3 ноября» across months.
export const formatRuDayRange = (from: string, until: string): string =>
  from.slice(0, 7) === until.slice(0, 7)
    ? `с ${Number(from.slice(8, 10))} по ${formatRuDay(until)}`
    : `с ${formatRuDay(from)} по ${formatRuDay(until)}`

// «+79528849420» → «+7 952 884-94-20»; any other shape is shown as stored.
export const formatPhone = (e164: string): string => {
  const m = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(e164)
  return m ? `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : e164
}
