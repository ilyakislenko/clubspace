import { dayLabel, formatRange } from "./calendar-helpers"

type Person = {
  firstname: string | null
  lastname: string | null
  email: string | null
}

// «Роман Савельев» / e-mail.
export const personName = (p: Person): string =>
  [p.firstname, p.lastname].filter(Boolean).join(" ") || p.email || "—"

// «Р. Савельев» — fits a narrow block.
export const coachShortName = (p: Person): string => {
  if (p.lastname && p.firstname) return `${p.firstname.charAt(0)}. ${p.lastname}`
  return p.lastname || p.firstname || p.email || "—"
}

// «ср, 4 ноября · 19:00–20:30»
export const slotLabel = (t: { date: string; startMin: number; endMin: number }): string =>
  `${dayLabel(t.date)} · ${formatRange(t.startMin, t.endMin)}`
