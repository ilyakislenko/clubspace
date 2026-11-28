import type {
  BankStatementCandidate,
  BankStatementPreview,
  BankStatementTransaction,
} from "../../shared/api/bank-statements"
import {
  amountWarning,
  candidateLabel,
  chosenMatches,
  doublePicked,
  flagLines,
  initialPicks,
  previewSummary,
  reasonsLine,
  resultSummary,
  transferAmount,
  transferWhen,
} from "./statement-view"

// Intl writes a no-break space between thousands and before «₽».
const plain = (s: string | null) => s?.replace(/\s/g, " ") ?? null

const cand = (over: Partial<BankStatementCandidate> = {}): BankStatementCandidate => ({
  subscriptionId: "s1",
  userId: "u1",
  memberName: "Иван Иванов",
  planName: "Безлимит",
  amount: 3000,
  currency: "RUB",
  startDate: "2026-11-01",
  soldOn: "2026-10-30",
  score: 90,
  reasons: ["AMOUNT_EXACT", "PAYER_NAME", "DATE_CLOSE"],
  paidBy: null,
  ...over,
})

const tx = (over: Partial<BankStatementTransaction> = {}): BankStatementTransaction => ({
  fingerprint: "f1",
  date: "2026-11-05",
  time: null,
  amount: 3000,
  receivedAmount: 3000,
  currency: "RUB",
  payer: "ИВАНОВ ИВАН ИВАНОВИЧ",
  purpose: "",
  docNumber: "12",
  status: "MATCHED",
  suggestedSubscriptionId: "s1",
  flags: [],
  candidates: [cand()],
  matchedTo: null,
  ...over,
})

const preview = (transactions: BankStatementTransaction[]): BankStatementPreview => ({
  format: "ONE_C",
  skippedDebits: 0,
  directionKnown: true,
  columns: null,
  transactions,
  counts: {
    matched: transactions.filter((t) => t.status === "MATCHED").length,
    ambiguous: transactions.filter((t) => t.status === "AMBIGUOUS").length,
    unmatched: transactions.filter((t) => t.status === "UNMATCHED").length,
    alreadyMatched: transactions.filter((t) => t.status === "ALREADY_MATCHED").length,
  },
})

describe("statement-view", () => {
  const p = preview([
    tx(),
    tx({ fingerprint: "f2", status: "AMBIGUOUS", suggestedSubscriptionId: null, candidates: [cand({ subscriptionId: "s2" })] }),
    tx({ fingerprint: "f3", status: "UNMATCHED", suggestedSubscriptionId: null, candidates: [] }),
    tx({ fingerprint: "f4", status: "ALREADY_MATCHED", suggestedSubscriptionId: null, candidates: [] }),
  ])

  it("pre-selects confident matches only", () => {
    expect(initialPicks(p)).toEqual({ f1: "s1", f2: null })
  })

  it("sends the chosen transfers with the amount received and the transfer’s date", () => {
    const withTime = preview([tx({ time: "14:03", receivedAmount: 2800, amount: 2800 })])
    expect(chosenMatches(withTime, { f1: "s1" })).toEqual([
      { fingerprint: "f1", subscriptionId: "s1", amount: 2800, paidOn: "2026-11-05", paidTime: "14:03" },
    ])
    // A pick that isn't among the transfer's candidates is not sent.
    expect(chosenMatches(p, { f1: "s1", f2: "s9" })).toHaveLength(1)
  })

  it("finds an abonement chosen for two transfers", () => {
    expect([...doublePicked({ f1: "s1", f2: "s1", f3: null })]).toEqual(["s1"])
    expect(doublePicked({ f1: "s1", f2: "s2" }).size).toBe(0)
  })

  it("says why a candidate fits, naming the parent", () => {
    expect(reasonsLine(cand())).toBe("Совпали: сумма, имя плательщика")
    expect(
      reasonsLine(cand({ reasons: ["AMOUNT_EXACT", "GUARDIAN_NAME", "PURPOSE_NAME"], paidBy: "Елена Петрова" })),
    ).toBe("Совпали: сумма, родитель Елена Петрова, имя в назначении")
    expect(reasonsLine(cand({ reasons: ["DATE_CLOSE"] }))).toBe("Совпала только дата")
    expect(plain(candidateLabel(cand()))).toBe("Иван Иванов · Безлимит · 3 000 ₽")
  })

  it("warns about a partial or an over-payment before confirming", () => {
    expect(amountWarning(tx(), cand())).toBeNull()
    expect(plain(amountWarning(tx({ receivedAmount: 2500 }), cand()))).toBe(
      "Пришло на 500 ₽ меньше цены — оплата будет отмечена на 2 500 ₽, разница станет разовой скидкой",
    )
    expect(plain(amountWarning(tx({ receivedAmount: 3500 }), cand()))).toBe(
      "Пришло на 500 ₽ больше цены — оплата будет отмечена на 3 500 ₽",
    )
    expect(amountWarning(tx(), null)).toBeNull()
  })

  it("words the flags the admin acts on", () => {
    expect(flagLines(tx({ flags: ["AMOUNT_DIFFERS", "SEVERAL_ABONEMENTS", "MAYBE_ALREADY_MATCHED"] }))).toEqual([
      "Сумма равна нескольким абонементам вместе — отметьте их оплату в карточках учеников",
      "Перевод на эту сумму в этот день уже сверяли — возможно, это он же из другой выгрузки",
    ])
  })

  it("formats the transfer and the summaries", () => {
    expect(transferWhen(tx())).toBe("5 нояб.")
    expect(transferWhen(tx({ time: "14:03" }))).toBe("5 нояб., 14:03")
    expect(plain(transferAmount(tx({ amount: 2999.5 })))).toBe("2 999,50 ₽")
    expect(previewSummary(p)).toBe("4 поступления: совпадают 1, выбрать 1, без пары 1, уже сверены 1")
    expect(previewSummary(preview([]))).toBe("В выписке нет поступлений")
    expect(resultSummary(5)).toBe("Отмечено 5 оплат переводом")
    expect(resultSummary(0)).toBe("Ничего не отмечено")
  })
})
