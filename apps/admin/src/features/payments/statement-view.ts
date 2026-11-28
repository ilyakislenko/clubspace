// «Сверить выписку»: the review's pure parts — what is pre-selected, what is
// sent, and the words for why a transfer fits an abonement.

import type {
  BankStatementCandidate,
  BankStatementFlag,
  BankStatementMatch,
  BankStatementPreview,
  BankStatementReason,
  BankStatementTransaction,
} from "../../shared/api/bank-statements"
import { pluralRu } from "../../shared/lib/plural-ru"
import { formatAmount } from "../subscriptions/subscription-display"

// fingerprint → the abonement chosen for it (null: none yet).
export type StatementPicks = Record<string, string | null>

// Confident matches start chosen; the rest wait for the admin.
export const initialPicks = (preview: BankStatementPreview): StatementPicks =>
  Object.fromEntries(
    preview.transactions
      .filter((t) => t.status === "MATCHED" || t.status === "AMBIGUOUS")
      .map((t) => [t.fingerprint, t.suggestedSubscriptionId]),
  )

// Abonements chosen for more than one transfer: one transfer pays one abonement.
export const doublePicked = (picks: StatementPicks): Set<string> => {
  const seen = new Set<string>()
  const twice = new Set<string>()
  for (const id of Object.values(picks)) {
    if (!id) continue
    if (seen.has(id)) twice.add(id)
    seen.add(id)
  }
  return twice
}

export const pickedCandidate = (
  t: BankStatementTransaction,
  picks: StatementPicks,
): BankStatementCandidate | null =>
  t.candidates.find((c) => c.subscriptionId === picks[t.fingerprint]) ?? null

// What «Отметить оплату» sends: every transfer with an abonement chosen.
export const chosenMatches = (
  preview: BankStatementPreview,
  picks: StatementPicks,
): BankStatementMatch[] =>
  preview.transactions.flatMap((t) => {
    const c = pickedCandidate(t, picks)
    return c
      ? [
          {
            fingerprint: t.fingerprint,
            subscriptionId: c.subscriptionId,
            amount: t.receivedAmount,
            paidOn: t.date,
            paidTime: t.time,
          },
        ]
      : []
  })

const REASON_WORD: Partial<Record<BankStatementReason, string>> = {
  AMOUNT_EXACT: "сумма",
  AMOUNT_CLOSE: "сумма почти",
  PAYER_NAME: "имя плательщика",
  PAYER_SHORT_NAME: "имя и инициал",
  PAYER_SURNAME: "фамилия",
  PURPOSE_NAME: "имя в назначении",
  PHONE: "телефон",
}

// «Совпали: сумма, родитель Елена Петрова». The date is left out: every
// candidate is near in time.
export const reasonsLine = (c: BankStatementCandidate): string => {
  const words = c.reasons.flatMap((r) => {
    if (r === "GUARDIAN_NAME" || r === "GUARDIAN_SHORT_NAME") {
      return c.paidBy ? [`родитель ${c.paidBy}`] : ["родитель"]
    }
    const w = REASON_WORD[r]
    return w ? [w] : []
  })
  return words.length > 0 ? `Совпали: ${words.join(", ")}` : "Совпала только дата"
}

export const candidateLabel = (c: BankStatementCandidate): string =>
  `${c.memberName} · ${c.planName} · ${formatAmount(c.amount, c.currency)}`

const FLAG_TEXT: Partial<Record<BankStatementFlag, string>> = {
  SEVERAL_ABONEMENTS:
    "Сумма равна нескольким абонементам вместе — отметьте их оплату в карточках учеников",
  SAME_ABONEMENT_TWICE: "В выписке есть похожий перевод — проверьте, не оплатили ли дважды",
  SIMILAR_CANDIDATES: "Подходят несколько учеников — выберите нужного",
  MAYBE_ALREADY_MATCHED:
    "Перевод на эту сумму в этот день уже сверяли — возможно, это он же из другой выгрузки",
}

export const flagLines = (t: BankStatementTransaction): string[] =>
  t.flags.flatMap((f) => (FLAG_TEXT[f] ? [FLAG_TEXT[f] as string] : []))

// A received amount different from the price is recorded as received, the
// way «Отметить оплату» records a changed amount — said before confirming.
export const amountWarning = (
  t: BankStatementTransaction,
  c: BankStatementCandidate | null,
): string | null => {
  if (!c || t.receivedAmount === c.amount) return null
  const diff = formatAmount(Math.abs(t.receivedAmount - c.amount), c.currency)
  return t.receivedAmount < c.amount
    ? `Пришло на ${diff} меньше цены — оплата будет отмечена на ${formatAmount(t.receivedAmount, c.currency)}, разница станет разовой скидкой`
    : `Пришло на ${diff} больше цены — оплата будет отмечена на ${formatAmount(t.receivedAmount, c.currency)}`
}

const dayFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" })

// «5 нояб., 14:03» — the day as the bank wrote it.
export const transferWhen = (t: Pick<BankStatementTransaction, "date" | "time">): string => {
  const day = dayFmt.format(new Date(`${t.date}T00:00:00Z`))
  return t.time ? `${day}, ${t.time}` : day
}

const kopFmt = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const transferAmount = (t: Pick<BankStatementTransaction, "amount" | "currency">): string =>
  Number.isInteger(t.amount)
    ? formatAmount(t.amount, t.currency)
    : `${kopFmt.format(t.amount)} ${t.currency === "RUB" ? "₽" : t.currency}`

// «12 поступлений: совпадают 7, выбрать 3, без пары 2» — zero parts left out.
export const previewSummary = (p: BankStatementPreview): string => {
  const { matched, ambiguous, unmatched, alreadyMatched } = p.counts
  const total = p.transactions.length
  if (total === 0) return "В выписке нет поступлений"
  const parts = [
    matched > 0 ? `совпадают ${matched}` : null,
    ambiguous > 0 ? `выбрать ${ambiguous}` : null,
    unmatched > 0 ? `без пары ${unmatched}` : null,
    alreadyMatched > 0 ? `уже сверены ${alreadyMatched}` : null,
  ].filter(Boolean)
  return `${total} ${pluralRu(total, "поступление", "поступления", "поступлений")}: ${parts.join(", ")}`
}

export const confirmLabel = (n: number): string =>
  n === 0 ? "Отметить оплату" : `Отметить оплату · ${n}`

export const resultSummary = (confirmed: number): string =>
  confirmed === 0
    ? "Ничего не отмечено"
    : `Отмечено ${confirmed} ${pluralRu(confirmed, "оплата", "оплаты", "оплат")} переводом`
