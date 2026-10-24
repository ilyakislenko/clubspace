import { formatRuDay, formatRuDayRange, pluralRu } from "../../shared/format-ru"
import type { Theme } from "../../shared/theme"

const DAY_MS = 24 * 60 * 60 * 1000

export type SubscriptionTone = "ok" | "warn" | "danger" | "muted"

export type SubscriptionState = {
  text: string
  tone: SubscriptionTone
}

export const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })

export const classesWord = (n: number): string =>
  pluralRu(n, "занятие", "занятия", "занятий")

export const PACK_USED_UP_TEXT =
  "Занятия закончились — приложение остаётся доступным. Продлите абонемент у администратора клуба."

// What a class pack with `remaining` visits left means for the member, or null
// when there is nothing to warn about. Running out never revokes app access —
// that comes from accessUntil only — so this is guidance, not a lock.
export const packGuidance = (
  remaining: number | null,
): SubscriptionState | null => {
  if (remaining === null) return null
  if (remaining <= 0) return { text: PACK_USED_UP_TEXT, tone: "warn" }
  if (remaining === 1) return { text: "Осталось 1 занятие", tone: "warn" }
  return null
}

type Freeze = { fromDate: string; untilDate: string }

// The device-local calendar day, as "YYYY-MM-DD" (freeze dates are club-local
// days with no zone, so they are compared as plain strings).
export const localYmd = (now: Date = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export const freezePhase = (
  f: Freeze,
  now: Date = new Date(),
): "upcoming" | "current" | "past" => {
  const today = localYmd(now)
  if (today < f.fromDate) return "upcoming"
  if (today <= f.untilDate) return "current"
  return "past"
}

const ymdMs = (ymd: string): number => {
  const [y, m, d] = ymd.split("-").map(Number)
  return Date.UTC(y, m - 1, d)
}

const freezeDays = (f: Freeze): number =>
  Math.round((ymdMs(f.untilDate) - ymdMs(f.fromDate)) / DAY_MS) + 1

// The freeze line under «Период», or null when it is over (or there is none).
export const freezeLine = (
  f: Freeze | null | undefined,
  now: Date = new Date(),
): string | null => {
  if (!f) return null
  const phase = freezePhase(f, now)
  if (phase === "past") return null
  const range = `${formatRuDayRange(f.fromDate, f.untilDate)} (${freezeDays(f)} дн.)`
  return phase === "current"
    ? `Заморозка ${range}`
    : `Заморозка запланирована: ${range}`
}

export const freezeExtendsText = (days: number): string =>
  `Срок абонемента продлён на ${days} дн. на время заморозки`

type Input = {
  accessUntil: string | null
  history: unknown[]
  current: { classesRemaining: number | null } | null
  freeze?: Freeze | null
}

// One truthful line for the abonement banner. Access comes from accessUntil
// alone; visits left are reported next to it, never instead of it.
export const subscriptionState = (
  { accessUntil, history, current, freeze }: Input,
  now: Date = new Date(),
): SubscriptionState => {
  const until = accessUntil ? new Date(accessUntil) : null
  if (until && until < now) {
    return { text: `Абонемент закончился ${fmtDate(accessUntil!)}`, tone: "danger" }
  }

  if (freeze && freezePhase(freeze, now) === "current") {
    const base = `Заморожен по ${formatRuDay(freeze.untilDate)}`
    if (!current || current.classesRemaining === null) {
      return { text: base, tone: "warn" }
    }
    const left = current.classesRemaining
    return {
      text:
        left > 0
          ? `${base} · осталось ${left} ${classesWord(left)}`
          : `${base} · занятий не осталось`,
      tone: "warn",
    }
  }

  const daysLeft = until
    ? Math.ceil((until.getTime() - now.getTime()) / DAY_MS)
    : null
  const soon = daysLeft !== null && daysLeft <= 14

  if (current && current.classesRemaining !== null) {
    const left = current.classesRemaining
    if (left <= 0) {
      return {
        text: until
          ? `${PACK_USED_UP_TEXT} · доступ до ${fmtDate(accessUntil!)}`
          : PACK_USED_UP_TEXT,
        tone: "warn",
      }
    }
    const base = `Осталось ${left} ${classesWord(left)}`
    return {
      text: until
        ? `${base} · до ${fmtDate(accessUntil!)}${soon ? ` (${daysLeft} дн.)` : ""}`
        : base,
      tone: left === 1 || soon ? "warn" : "ok",
    }
  }

  if (until) {
    return {
      text: soon
        ? `Активен · до ${fmtDate(accessUntil!)} (${daysLeft} дн.)`
        : `Активен · до ${fmtDate(accessUntil!)}`,
      tone: soon ? "warn" : "ok",
    }
  }

  if (current) return { text: "Доступ без ограничения по времени", tone: "ok" }
  if (history.length > 0) {
    return { text: "Нет действующего абонемента", tone: "muted" }
  }
  return { text: "Абонемент не оформлен", tone: "muted" }
}

// Text colour for a state line. Shared by the abonement screen and Home card.
export const toneColor = (
  colors: Pick<Theme["colors"], "danger" | "accent" | "text" | "muted">,
  tone: SubscriptionTone,
): string =>
  tone === "danger"
    ? colors.danger
    : tone === "warn"
      ? colors.accent
      : tone === "ok"
        ? colors.text
        : colors.muted

export type AccessVariant = "ok" | "warn" | "expired"

// The club-level access window (membership.accessUntil), for clubs that don't
// use abonements: expired once it has passed, "warn" in the last two weeks.
export const accessStatus = (
  accessUntil: string | null | undefined,
  now: Date = new Date(),
): { variant: AccessVariant; days: number } | null => {
  if (!accessUntil) return null
  const days = Math.ceil((new Date(accessUntil).getTime() - now.getTime()) / DAY_MS)
  return { variant: days < 0 ? "expired" : days <= 14 ? "warn" : "ok", days }
}
