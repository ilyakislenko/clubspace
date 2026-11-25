import { pluralRu } from "../../shared/lib/plural-ru"

const MONTHS = [
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
]

const parts = (ymd: string): [number, number, number] | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** Today as YYYY-MM-DD on this computer's calendar. */
export const todayYmd = (now: Date): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`

/** Full years on `today` (both YYYY-MM-DD), the birthday itself counted. */
export const ageOn = (dateOfBirth: string, today: string): number | null => {
  const b = parts(dateOfBirth)
  const t = parts(today)
  if (!b || !t) return null
  const hadBirthday = t[1] > b[1] || (t[1] === b[1] && t[2] >= b[2])
  return t[0] - b[0] - (hadBirthday ? 0 : 1)
}

/**
 * The member card's «Дата рождения»: «4 мая 2016 (10 лет)». The stored date
 * is a calendar day, so it is read as text, never shifted by a time zone.
 */
export const formatBirthDate = (dateOfBirth: string, today: string): string => {
  const b = parts(dateOfBirth)
  if (!b) return dateOfBirth
  const age = ageOn(dateOfBirth, today)
  const date = `${b[2]} ${MONTHS[b[1] - 1]} ${b[0]}`
  return age === null || age < 0
    ? date
    : `${date} (${age} ${pluralRu(age, "год", "года", "лет")})`
}
