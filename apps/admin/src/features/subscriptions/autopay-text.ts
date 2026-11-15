import { pluralRu } from "../../shared/lib/plural-ru"
import { formatAmount } from "./subscription-display"

// Pure texts of a member's autopay (MemberAutopayBlock, «Продлить»). Amounts
// and the card come from the server only for club admins (null otherwise), so
// every text simply leaves out what it didn't get.

// Why an agreement stopped and waits for the member (MemberAutopay.needsActionReason).
export type AutopayStopReason = "CHARGE_FAILED" | "CARD_EXPIRED" | "TERMS_CHANGED" | "GRANT_REFUSED"

const STOP_REASON_TEXT: Record<AutopayStopReason, string> = {
  CHARGE_FAILED: "списание не прошло четыре раза",
  CARD_EXPIRED: "срок действия карты истёк",
  TERMS_CHANGED: "клуб изменил условия тарифа, ученик ещё не подтвердил",
  GRANT_REFUSED: "деньги списаны, но абонемент не оформлен",
}

// The provider's decline text when there is one, else what the stop means.
const stopReasonText = (reason: string | null, lastError: string | null): string =>
  lastError ?? STOP_REASON_TEXT[reason as AutopayStopReason] ?? "списание не прошло"

// Ends a sentence once: a short month («15 дек.») or a provider text may
// already end with a full stop.
const sentence = (s: string): string => (s.endsWith(".") ? s : `${s}.`)

// «14 дек.» of a club-local calendar day; rendered in UTC so it never shifts.
const shortDay = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" })
export const formatAutopayDay = (ymd: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd)
  return m ? shortDay.format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))) : ymd
}

// «14 дек.» of an instant on the browser's clock (cancelledAt, a settings error).
export const formatAutopayInstant = (iso: string): string =>
  new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })

type NextCharge = { on: string; amount: number | null; kind: "term" | "pack" }

export type AutopayView = {
  planName: string
  status: "ACTIVE" | "NEEDS_ACTION" | "CANCELLED"
  needsActionReason: string | null
  cardLabel: string | null
  termsAmount: number | null
  currency: string
  nextCharge: NextCharge | null
  lastError: string | null
  // Club-local day of the last decline.
  lastFailedOn: string | null
  nextAttemptOn: string | null
  newTerms: { amount: number | null; durationDays: number; classCount: number | null } | null
  cancelledAt: string | null
  cancelSource: string | null
  cancelReason: string | null
  cancelledBy: { name: string } | null
}

// Line 1 of a live agreement: «Автоплатёж «БЖЖ 12» · следующее списание
// 14 дек. · 4 000 ₽ · карта •• 4444» (pack: «когда закончатся занятия, не
// позже 14 дек.»). A stopped one has no next charge.
export const autopayHeadline = (a: AutopayView): string => {
  const next = a.status === "ACTIVE" ? a.nextCharge : null
  const amount = next?.amount ?? a.termsAmount
  return [
    `Автоплатёж «${a.planName}»`,
    next
      ? next.kind === "pack"
        ? `когда закончатся занятия, не позже ${formatAutopayDay(next.on)}`
        : `следующее списание ${formatAutopayDay(next.on)}`
      : null,
    amount !== null ? formatAmount(amount, a.currency) : null,
    a.cardLabel,
  ]
    .filter(Boolean)
    .join(" · ")
}

export type AutopayNote = { tone: "destructive" | "warning" | "muted"; text: string }

// What staff should know beyond line 1, only when true: a stop, a pending
// price confirmation, declines being retried, or how it was switched off.
export const autopayNotes = (a: AutopayView): AutopayNote[] => {
  if (a.status === "CANCELLED") {
    const by =
      a.cancelSource === "MEMBER"
        ? "учеником"
        : a.cancelSource === "STAFF"
          ? [a.cancelledBy?.name ?? "сотрудником клуба", a.cancelReason].filter(Boolean).join(": ")
          : ["автоматически", a.cancelReason].filter(Boolean).join(": ")
    const when = a.cancelledAt ? ` ${formatAutopayInstant(a.cancelledAt)}` : ""
    return [{ tone: "muted", text: `Автоплатёж «${a.planName}» отключён${when} — ${by}` }]
  }
  const notes: AutopayNote[] = []
  const stopped = a.status === "NEEDS_ACTION"
  if (stopped && a.needsActionReason !== "TERMS_CHANGED") {
    notes.push({
      tone: "destructive",
      text: `${sentence(`Автоплатёж остановлен: ${stopReasonText(a.needsActionReason, a.lastError)}`)} Ученик может оплатить в приложении.`,
    })
  }
  if (a.newTerms || a.needsActionReason === "TERMS_CHANGED") {
    const amount = a.newTerms?.amount ?? null
    notes.push({
      tone: stopped ? "destructive" : "warning",
      text:
        amount !== null
          ? `Ждёт подтверждения новой цены ${formatAmount(amount, a.currency)}`
          : "Ждёт, когда ученик подтвердит новые условия",
    })
  }
  if (!stopped && a.lastError) {
    notes.push({
      tone: "warning",
      text: [
        sentence(
          `Не прошло списание${a.lastFailedOn ? ` ${formatAutopayDay(a.lastFailedOn)}` : ""}: ${a.lastError}`,
        ),
        a.nextAttemptOn ? sentence(`Повторим ${formatAutopayDay(a.nextAttemptOn)}`) : null,
      ]
        .filter(Boolean)
        .join(" "),
    })
  }
  return notes
}

// A «Автоплатёж не прошёл» row's reason and what comes next: «повтор 16 дек.»
// while retries are scheduled, «ждёт ученика» once it stopped.
export const attentionText = (row: {
  reason: string | null
  lastError: string | null
  nextAttemptOn: string | null
}): { reason: string; next: string } => ({
  reason: stopReasonText(row.reason, row.lastError),
  next: row.nextAttemptOn ? `повтор ${formatAutopayDay(row.nextAttemptOn)}` : "ждёт ученика",
})

// The muted second line of a «Продлить» row covered by autopay.
export const renewalAutopayLine = (
  autopay: { status: string; nextChargeOn: string | null } | null,
): string | null =>
  autopay?.status === "ACTIVE"
    ? ["продлится автоплатежом", autopay.nextChargeOn ? formatAutopayDay(autopay.nextChargeOn) : null]
        .filter(Boolean)
        .join(" ")
    : null

// «4 учеников» after «у» («у 1 ученика», «у 21 ученика»).
export const autopayPeople = (n: number): string =>
  `${n} ${pluralRu(n, "ученика", "учеников", "учеников")}`

type PlanTerms = { price: number; durationDays: number; classCount: number | null }

// What saving a tariff does to the members renewing it by autopay: ends it
// (autopay, online sale or the tariff itself switched off), asks them to accept
// new terms (a higher price, another term or pack size — the server's
// TERMS_CHANGED rule), or nothing. A tariff without autopay affects nobody.
export const autopayImpact = (
  saved: PlanTerms & { autopayAvailable: boolean },
  next: PlanTerms & { autopayAvailable: boolean },
): "off" | "terms" | null =>
  !saved.autopayAvailable
    ? null
    : !next.autopayAvailable
      ? "off"
      : next.price > saved.price ||
          next.durationDays !== saved.durationDays ||
          next.classCount !== saved.classCount
        ? "terms"
        : null
