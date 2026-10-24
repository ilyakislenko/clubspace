import { pluralRu } from "../../shared/format-ru"

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

type Input = {
  accessUntil: string | null
  history: unknown[]
  current: { classesRemaining: number | null } | null
}

// One truthful line for the abonement banner. Access comes from accessUntil
// alone; visits left are reported next to it, never instead of it.
export const subscriptionState = (
  { accessUntil, history, current }: Input,
  now: Date = new Date(),
): SubscriptionState => {
  const until = accessUntil ? new Date(accessUntil) : null
  if (until && until < now) {
    return { text: `Абонемент закончился ${fmtDate(accessUntil!)}`, tone: "danger" }
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
