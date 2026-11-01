import type { ActingAs } from "../../shared/acting-as"
import type {
  DependentRelation,
  MyDependent,
} from "../../shared/api/dependents"

export const CONSENT_TEXT =
  "Я родитель или законный представитель ребёнка и даю согласие на обработку его персональных данных"

export const RELATION_LABEL: Record<DependentRelation, string> = {
  PARENT: "Родитель",
  GUARDIAN: "Опекун",
  OTHER: "Представитель",
}

export const RELATION_ORDER: readonly DependentRelation[] = [
  "PARENT",
  "GUARDIAN",
  "OTHER",
]

export const dependentName = (d: {
  firstname: string | null
  lastname: string | null
}): string =>
  [d.firstname, d.lastname].filter(Boolean).join(" ").trim() || "Ребёнок"

/** Confirmed children: the only ones the guardian may act for. */
export const switchableDependents = (list: MyDependent[]): MyDependent[] =>
  list.filter((d) => d.status === "ACTIVE")

/** Children a club added and named this guardian for, awaiting confirmation. */
export const pendingInvites = (list: MyDependent[]): MyDependent[] =>
  list.filter((d) => d.status === "PENDING")

export const toActingAs = (d: MyDependent): ActingAs => ({
  id: d.id,
  firstname: d.firstname ?? "",
  lastname: d.lastname,
})

/**
 * The profile to keep acting as after the guardian's children were reloaded:
 * the same child with its current name while it is still a confirmed child,
 * else null (back to the guardian) — it was removed, deleted, or unconfirmed.
 */
export const reconcileActingAs = (
  current: ActingAs | null,
  list: MyDependent[],
): ActingAs | null => {
  if (!current) return null
  const match = list.find((d) => d.id === current.id && d.status === "ACTIVE")
  return match ? toActingAs(match) : null
}

const pad = (n: number) => String(n).padStart(2, "0")

/** "2015-03-07" → "07.03.2015"; anything else is returned unchanged. */
export const formatBirthDate = (ymd: string | null): string => {
  const m = ymd ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd) : null
  return m ? `${m[3]}.${m[2]}.${m[1]}` : (ymd ?? "")
}

/**
 * Parses a typed birth date «ДД.ММ.ГГГГ» (dots, slashes, dashes or spaces
 * between the parts) into the API's YYYY-MM-DD. Null for an impossible date,
 * one in the future (against `today`, a YYYY-MM-DD) or before 1900.
 */
export const parseBirthDate = (input: string, today: string): string | null => {
  const m = /^\s*(\d{1,2})[./\-\s](\d{1,2})[./\-\s](\d{4})\s*$/.exec(input)
  if (!m) return null
  const day = Number(m[1])
  const month = Number(m[2])
  const year = Number(m[3])
  if (year < 1900 || month < 1 || month > 12 || day < 1) return null
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day > daysInMonth) return null
  const ymd = `${year}-${pad(month)}-${pad(day)}`
  return ymd > today ? null : ymd
}

/** Today as YYYY-MM-DD on the device's calendar. */
export const todayYmd = (now: Date): string =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

/**
 * Places the dots while a birth date is typed digit by digit:
 * "0703" → "07.03", "07.032" → "07.03.2", "07032015" → "07.03.2015". Text
 * with other separators, or dots typed elsewhere ("7.3.2015"), is left as
 * typed — parseBirthDate reads those too.
 */
export const maskBirthDate = (input: string): string => {
  const ownDots = [...input].every(
    (ch, i) => /\d/.test(ch) || (ch === "." && (i === 2 || i === 5)),
  )
  if (!ownDots) return input
  const digits = input.replace(/\D/g, "").slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`
}
