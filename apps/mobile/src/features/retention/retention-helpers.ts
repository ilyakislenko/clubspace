import type {
  AtRiskContact,
  AtRiskList,
  AtRiskMember,
  AtRiskReason,
  AtRiskSummary,
} from "../../shared/api/retention"
import type { WorkspaceSummary } from "../../shared/api/workspaces"
import { pluralRu } from "../../shared/format-ru"
import type { ThemeColors } from "../../shared/themes"
import { RELATION_LABEL } from "../children/children-helpers"

const DAY_MS = 24 * 60 * 60 * 1000

export const STAFF_ROLES = ["coach", "head_coach", "admin"]

/** Who may open «Кому позвонить»: the owner and the club's staff roles. */
export const isStaffWorkspace = (
  ws: Pick<WorkspaceSummary, "roleName" | "isOwner"> | null | undefined,
): boolean => !!ws && (ws.isOwner || STAFF_ROLES.includes(ws.roleName))

// Priority order, the same as the server's.
export const REASON_ORDER: AtRiskReason[] = [
  "lapsed",
  "newcomer",
  "absent",
  "declining",
]

export const REASON_LABEL: Record<AtRiskReason, string> = {
  lapsed: "Абонемент кончился",
  newcomer: "Новичок",
  absent: "Давно не был",
  declining: "Реже, чем раньше",
}

// Theme colour keys (foreground, soft background) for each reason's chip.
export const REASON_TONE: Record<
  AtRiskReason,
  { fg: keyof ThemeColors; bg: keyof ThemeColors }
> = {
  lapsed: { fg: "danger", bg: "dangerSoft" },
  newcomer: { fg: "accent", bg: "accentSoft" },
  absent: { fg: "warning", bg: "warningSoft" },
  declining: { fg: "textSecondary", bg: "surfaceMuted" },
}

const BODY_LABEL: Record<AtRiskReason, string> = {
  lapsed: "кончился абонемент",
  newcomer: "новички",
  absent: "давно не были",
  declining: "ходят реже",
}

export const callListTitle = (n: number): string =>
  `Позвонить: ${n} ${pluralRu(n, "ученику", "ученикам", "ученикам")}`

export const callListBody = (summary: AtRiskSummary): string =>
  REASON_ORDER.filter((r) => summary[r] > 0)
    .map((r) => `${BODY_LABEL[r]}: ${summary[r]}`)
    .join(" · ")

/** Reason chips filter locally so the counts in the summary stay whole. */
export const visibleEntries = (
  list: AtRiskList,
  reason: AtRiskReason | null,
  showSnoozed: boolean,
): AtRiskList["data"] =>
  list.data.filter(
    (m) => (showSnoozed || !m.snoozed) && (reason === null || m.reason === reason),
  )

// Mirror of the server's summarizeRisk: snoozed entries count only in `snoozed`.
const summarize = (data: AtRiskList["data"]): AtRiskSummary => {
  const out: AtRiskSummary = {
    total: 0,
    lapsed: 0,
    newcomer: 0,
    absent: 0,
    declining: 0,
    snoozed: 0,
  }
  for (const m of data) {
    if (m.snoozed) {
      out.snoozed += 1
      continue
    }
    out.total += 1
    out[m.reason] += 1
  }
  return out
}

/** Optimistic update after «Связались»: hide the member and recount. */
export const applyContact = (
  prev: AtRiskList | null,
  userId: string,
  contact: AtRiskContact,
): AtRiskList | null => {
  if (!prev) return prev
  const data = prev.data.map((m) =>
    m.userId === userId ? { ...m, snoozed: true, lastContact: contact } : m,
  )
  return { ...prev, data, summary: summarize(data) }
}

const agoShort = (iso: string, now: Date): string => {
  const d = Math.floor((now.getTime() - new Date(iso).getTime()) / DAY_MS)
  if (d <= 0) return "сегодня"
  if (d === 1) return "вчера"
  if (d < 14) return `${d} дн. назад`
  return `${Math.floor(d / 7)} нед. назад`
}

export const contactLine = (c: AtRiskContact, now: Date): string =>
  `Связались ${agoShort(c.at, now)}: ${c.byName}${c.note ? ` — «${c.note}»` : ""}`

type Guardian = AtRiskMember["guardians"][number]

export type CallContact = {
  phone: string | null
  email: string | null
  /** The parent being called about a child; null = the member themselves. */
  guardian: { name: string; label: string } | null
}

const hasPhone = (g: Guardian) => (g.phone ? 1 : 0)

/**
 * Whom to call about an at-risk member. A child (a member with guardians) is
 * reached through a parent: a confirmed one first, one with a phone first.
 * Everyone else through their own phone.
 */
export const callContact = (
  m: Pick<AtRiskMember, "phone" | "email" | "guardians">,
): CallContact => {
  const [best] = [...m.guardians].sort(
    (a, b) =>
      Number(b.confirmed) - Number(a.confirmed) || hasPhone(b) - hasPhone(a),
  )
  if (!best) return { phone: m.phone, email: m.email, guardian: null }
  const name =
    [best.firstname, best.lastname].filter(Boolean).join(" ").trim() ||
    best.email ||
    "Без имени"
  const label = `${RELATION_LABEL[best.relation]}${best.confirmed ? "" : " (не подтвердил)"}`
  return { phone: best.phone, email: best.email, guardian: { name, label } }
}
