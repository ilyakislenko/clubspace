import { formatMoney, formatRuDay, pluralRu } from "../../shared/format-ru"
import { classesWord, type SubscriptionState } from "./subscription-state"

// The member's autopay agreement as «Мой абонемент» reads it (the server's
// MyAutopay; structural so the helpers stay framework-free).
export type AutopayStatus = "ACTIVE" | "NEEDS_ACTION" | "CANCELLED"

export type AutopayTerms = {
  amount: number
  durationDays: number
  classCount: number | null
}

export type AutopayNextCharge = {
  // Club-local calendar day (YYYY-MM-DD).
  on: string
  amount: number
  // A pack renews when its classes run out, at the latest on `on`.
  kind: "term" | "pack"
}

export type AutopayLike = {
  status: AutopayStatus
  needsActionReason: string | null
  planName: string
  cardLabel: string | null
  termsAmount: number | null
  currency: string
  termsDurationDays: number
  termsClassCount: number | null
  nextCharge: AutopayNextCharge | null
  lastError: string | null
  lastFailedOn: string | null
  nextAttemptOn: string | null
  newTerms: AutopayTerms | null
  cancelledAt: string | null
  cancelSource: string | null
  cancelReason: string | null
}

// «4 000 ₽ за 30 дней» / «4 000 ₽ за 8 занятий на 30 дней».
export const autopayTermsText = (t: AutopayTerms, currency: string): string => {
  const money = formatMoney(t.amount, currency)
  const days = `${t.durationDays} ${pluralRu(t.durationDays, "день", "дня", "дней")}`
  return t.classCount != null
    ? `${money} за ${t.classCount} ${classesWord(t.classCount)} на ${days}`
    : `${money} за ${days}`
}

// «Следующее списание 14 декабря — 4 000 ₽» / for a pack «Когда закончатся
// занятия, но не позже 14 декабря — 4 000 ₽».
export const nextChargeText = (
  next: AutopayNextCharge,
  currency: string,
): string => {
  const money = formatMoney(next.amount, currency)
  return next.kind === "pack"
    ? `Когда закончатся занятия, но не позже ${formatRuDay(next.on)} — ${money}`
    : `Следующее списание ${formatRuDay(next.on)} — ${money}`
}

// «Автоплатёж включён · карта •• 4444».
export const autopayHeadline = (a: Pick<AutopayLike, "cardLabel">): string =>
  a.cardLabel ? `Автоплатёж включён · ${a.cardLabel}` : "Автоплатёж включён"

// Why an agreement stopped, when the server sent no decline text.
const STOP_REASON: Record<string, string> = {
  CHARGE_FAILED: "списание не прошло",
  CARD_EXPIRED: "срок действия карты истёк",
  GRANT_REFUSED: "абонемент не оформился",
}

// A local calendar day of an ISO instant (the cancel time) as YYYY-MM-DD.
const localDay = (iso: string): string => {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// What the card offers: cancel only, confirm a price rise (+ cancel), or
// nothing (already cancelled).
export type AutopayActions = "cancel" | "confirm" | "none"

export type AutopayCardView = {
  // Null for a cancelled agreement: its single muted line says it all.
  headline: string | null
  lines: SubscriptionState[]
  actions: AutopayActions
}

/**
 * The lines of one agreement on «Мой абонемент» (design §5.2): the headline
 * and next charge while active, a pending decline, a price change to confirm,
 * a stop to fix by paying again, or the recent cancellation.
 */
export const autopayCardView = (a: AutopayLike): AutopayCardView => {
  if (a.status === "CANCELLED") {
    const day = a.cancelledAt ? ` ${formatRuDay(localDay(a.cancelledAt))}` : ""
    // The member's own refusal needs no reason; the club's or the system's does.
    const reason =
      a.cancelSource !== "MEMBER" && a.cancelReason ? ` — ${a.cancelReason}` : ""
    return {
      headline: null,
      lines: [{ text: `Автоплатёж отключён${day}${reason}`, tone: "muted" }],
      actions: "none",
    }
  }

  // A rise waits for the member — whether the charge already stopped on it
  // (NEEDS_ACTION / TERMS_CHANGED) or the club changed the tariff ahead.
  const newTerms = a.newTerms
  if (newTerms) {
    const was = autopayTermsText(
      {
        amount: a.termsAmount ?? 0,
        durationDays: a.termsDurationDays,
        classCount: a.termsClassCount,
      },
      a.currency,
    )
    return {
      headline: autopayHeadline(a),
      lines: [
        {
          text: `Клуб изменил тариф: было ${was}, стало ${autopayTermsText(newTerms, a.currency)}. Без вашего подтверждения деньги не спишутся.`,
          tone: "warn",
        },
      ],
      actions: "confirm",
    }
  }

  if (a.status === "NEEDS_ACTION") {
    const reason =
      a.lastError ??
      STOP_REASON[a.needsActionReason ?? ""] ??
      STOP_REASON.CHARGE_FAILED
    return {
      headline: null,
      lines: [
        {
          text: `Автоплатёж остановлен: ${reason}. Оплатите абонемент ниже с включённым автопродлением — новая карта сохранится, и автоплатёж продолжится.`,
          tone: "danger",
        },
      ],
      actions: "cancel",
    }
  }

  const lines: SubscriptionState[] = []
  if (a.nextCharge) {
    lines.push({ text: nextChargeText(a.nextCharge, a.currency), tone: "muted" })
  }
  // Declines in a row, retried by the server.
  if (a.lastError) {
    const when = a.lastFailedOn ? ` ${formatRuDay(a.lastFailedOn)}` : ""
    const retry = a.nextAttemptOn
      ? ` Повторим ${formatRuDay(a.nextAttemptOn)}.`
      : ""
    lines.push({
      text: `Не удалось списать${when}: ${a.lastError}.${retry} Пополните карту или отключите автоплатёж.`,
      tone: "warn",
    })
  }
  return { headline: autopayHeadline(a), lines, actions: "cancel" }
}

// «Подтвердить 4 500 ₽» — the price the member agrees to.
export const confirmTermsLabel = (t: AutopayTerms, currency: string): string =>
  `Подтвердить ${formatMoney(t.amount, currency)}`

// The cancel confirmation's message. `paidUntil` is the end instant of the
// abonement the agreement renews (null when none is current), read on the
// device's calendar like the abonement card's period.
export const cancelAutopayMessage = (paidUntil: string | null): string =>
  paidUntil
    ? `Следующих списаний не будет. Абонемент действует до ${formatRuDay(localDay(paidUntil))}.`
    : "Следующих списаний не будет."

// The latest end among the member's abonements of that tariff, or null.
export const paidUntilFor = (
  planId: string | null,
  abonements: readonly { planId: string; endDate: string | null }[],
): string | null => {
  if (!planId) return null
  const ends = abonements
    .flatMap((s) => (s.planId === planId && s.endDate ? [s.endDate] : []))
    .sort()
  return ends.length > 0 ? ends[ends.length - 1] : null
}

// A live agreement (not cancelled): the screen's hint names where to cancel.
export const hasLiveAutopay = (list: { status: AutopayStatus }[]): boolean =>
  list.some((a) => a.status !== "CANCELLED")
