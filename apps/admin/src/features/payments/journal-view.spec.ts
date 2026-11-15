import type {
  PaymentJournalEntry,
  PaymentJournalEntryDetail,
  PaymentJournalTotals,
  PaymentJournalUnapplied,
} from "../../shared/api/payment-journal"
import { ANALYTICS_ALL } from "../../shared/lib/analytics"
import {
  EMPTY_JOURNAL_STATE,
  canDeleteRefund,
  clubToday,
  customRangeError,
  defaultRefundMethod,
  emptyText,
  entryAmount,
  entryDiscountNote,
  entryPriceFacts,
  discountsLine,
  entryTitle,
  entryWhat,
  formatEntryAt,
  isFiltered,
  journalFilters,
  journalSearch,
  methodLabel,
  entryMethodLabel,
  methodsLine,
  onlineRefundable,
  panelFilterCount,
  parseJournalSearch,
  parseRefundAmount,
  periodOf,
  presetRange,
  refundHint,
  refundIdOf,
  refundMax,
  refundMethodLabel,
  refundMethods,
  refundTargetOf,
  refundedNote,
  subjectRefundable,
  summaryLine,
  unappliedTitle,
  type RefundSubject,
} from "./journal-view"

const ID = "7b0c2f4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f"
const ID2 = "11111111-2222-4333-8444-555555555555"

const entry = (patch: Partial<PaymentJournalEntry> = {}): PaymentJournalEntry => ({
  id: `sub:${ID}`,
  kind: "payment",
  source: "abonement",
  at: "2026-11-03T15:40:00.000Z",
  amount: 4000,
  currency: "RUB",
  method: "CASH",
  member: { userId: ID, name: "Иван Петров", isMember: true },
  itemName: "БЖЖ 12",
  subscriptionId: ID,
  eventRegistrationId: null,
  eventId: null,
  markedBy: { userId: ID2, name: "Анна Ли" },
  refundedAmount: 0,
  refundable: 4000,
  online: null,
  reason: null,
  refundOf: null,
  listPrice: null,
  discountName: null,
  discountAmount: 0,
  oneOffDiscount: 0,
  pricedBy: null,
  ...patch,
})

const totals = (patch: Partial<PaymentJournalTotals> = {}): PaymentJournalTotals => ({
  currency: "RUB",
  received: 412000,
  refunded: 0,
  net: 412000,
  byMethod: [
    { method: "ONLINE", received: 166000, refunded: 0, count: 20 },
    { method: "CASH", received: 120000, refunded: 0, count: 10 },
    { method: "TRANSFER", received: 80000, refunded: 0, count: 5 },
    { method: "CARD", received: 40000, refunded: 0, count: 2 },
  ],
  discounted: { count: 0, amount: 0, oneOffAmount: 0 },
  ...patch,
})

// Intl puts a narrow no-break space into numbers; compare with plain spaces.
const plain = (s: string | null) => s?.replace(/\s/g, " ") ?? null

describe("period presets", () => {
  it("gives club-local dates for this and the previous month", () => {
    expect(presetRange("month", "2026-11-15")).toEqual({ from: "2026-11-01", to: "2026-11-15" })
    expect(presetRange("prevMonth", "2026-11-15")).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    })
    // January's previous month is last year's December; February ends on the 28th.
    expect(presetRange("prevMonth", "2026-01-10")).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    })
    expect(presetRange("prevMonth", "2026-03-31")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    })
  })

  it("sends no dates for «За 30 дней» (the dashboard's window)", () => {
    expect(presetRange("30d", "2026-11-15")).toBeNull()
    expect(journalFilters(EMPTY_JOURNAL_STATE)).toEqual({
      from: undefined,
      to: undefined,
      method: undefined,
      kind: undefined,
      markedById: undefined,
      discounted: undefined,
      discountId: undefined,
      pricedById: undefined,
      gymId: undefined,
      directionId: undefined,
      groupId: undefined,
      coachId: undefined,
      q: undefined,
    })
  })

  it("names a range by its preset", () => {
    const today = "2026-11-15"
    expect(periodOf({ from: null, to: null }, today)).toBe("30d")
    expect(periodOf({ from: "2026-11-01", to: "2026-11-15" }, today)).toBe("month")
    expect(periodOf({ from: "2026-10-01", to: "2026-10-31" }, today)).toBe("prevMonth")
    expect(periodOf({ from: "2026-10-05", to: "2026-10-31" }, today)).toBe("custom")
  })

  it("takes today on the club's clock", () => {
    const at = new Date("2026-11-14T20:30:00Z")
    expect(clubToday("Asia/Tomsk", at)).toBe("2026-11-15")
    expect(clubToday("Europe/Moscow", at)).toBe("2026-11-14")
  })

  it("refuses a range the server refuses", () => {
    expect(customRangeError("2026-11-01", "2026-11-15")).toBeNull()
    expect(customRangeError("2026-11-01", "")).toBe("Укажите обе даты")
    expect(customRangeError("2026-11-15", "2026-11-01")).toBe("Дата «по» раньше даты «с»")
    expect(customRangeError("2025-11-14", "2026-11-15")).toBe("Период — не больше 366 дней")
    expect(customRangeError("2025-11-15", "2026-11-15")).toBeNull()
  })
})

describe("URL state", () => {
  it("round-trips a view in a fixed order", () => {
    const state = {
      ...EMPTY_JOURNAL_STATE,
      from: "2026-11-01",
      to: "2026-11-15",
      method: "CASH" as const,
      kind: "refund" as const,
      markedById: ID2,
      pricedById: ID2,
      discounted: true,
      scope: { gymId: ANALYTICS_ALL, directionId: ID, groupId: ANALYTICS_ALL, coachId: ANALYTICS_ALL },
      q: " Иван ",
      entry: `sub:${ID}`,
    }
    const search = journalSearch(state)
    expect(search).toBe(
      `?from=2026-11-01&to=2026-11-15&method=CASH&kind=refund&markedById=${ID2}&discounted=1&pricedById=${ID2}&directionId=${ID}&q=%D0%98%D0%B2%D0%B0%D0%BD&entry=sub%3A${ID}`,
    )
    expect(parseJournalSearch(search)).toEqual({ ...state, q: "Иван" })
  })

  it("is empty for the default view", () => {
    expect(journalSearch(EMPTY_JOURNAL_STATE)).toBe("")
    expect(parseJournalSearch("")).toEqual(EMPTY_JOURNAL_STATE)
  })

  it("drops broken parts of a hand-edited link", () => {
    expect(
      parseJournalSearch(
        "?from=2026-11-15&to=2026-11-01&method=CHEQUE&kind=all&markedById=x&gymId=1&entry=sub:nope",
      ),
    ).toEqual(EMPTY_JOURNAL_STATE)
    // One date alone is no range.
    expect(parseJournalSearch("?from=2026-11-01").from).toBeNull()
    expect(parseJournalSearch(`?q=${"я".repeat(150)}`).q).toHaveLength(100)
  })

  it("keeps one discount filter: a discount's id wins over «Со скидкой»", () => {
    expect(parseJournalSearch(`?discounted=1&discountId=${ID}`)).toMatchObject({
      discounted: false,
      discountId: ID,
    })
    expect(parseJournalSearch("?discounted=true").discounted).toBe(false)
    expect(parseJournalSearch("?discountId=x&pricedById=y")).toEqual(EMPTY_JOURNAL_STATE)
    expect(journalFilters({ ...EMPTY_JOURNAL_STATE, discountId: ID })).toMatchObject({
      discounted: undefined,
      discountId: ID,
    })
    expect(journalFilters({ ...EMPTY_JOURNAL_STATE, discounted: true }).discounted).toBe(true)
  })

  it("counts the panel's filters and knows when anything narrows the rows", () => {
    expect(panelFilterCount(EMPTY_JOURNAL_STATE)).toBe(0)
    expect(isFiltered(EMPTY_JOURNAL_STATE)).toBe(false)
    expect(emptyText(EMPTY_JOURNAL_STATE)).toBe("За этот период оплат нет")
    // The period alone is not a filter.
    expect(isFiltered({ ...EMPTY_JOURNAL_STATE, from: "2026-11-01", to: "2026-11-15" })).toBe(false)

    const scoped = {
      ...EMPTY_JOURNAL_STATE,
      markedById: ID2,
      scope: { ...EMPTY_JOURNAL_STATE.scope, groupId: ID },
    }
    expect(panelFilterCount(scoped)).toBe(2)
    expect(panelFilterCount({ ...scoped, kind: "payment" })).toBe(3)
    expect(panelFilterCount({ ...scoped, discountId: ID, pricedById: ID2 })).toBe(4)
    expect(isFiltered({ ...EMPTY_JOURNAL_STATE, discounted: true })).toBe(true)
    expect(isFiltered({ ...EMPTY_JOURNAL_STATE, kind: "refund" })).toBe(true)
    expect(emptyText(scoped)).toBe("Ничего не нашлось — измените фильтры")
    expect(isFiltered({ ...EMPTY_JOURNAL_STATE, method: "NONE" })).toBe(true)
    expect(isFiltered({ ...EMPTY_JOURNAL_STATE, q: "  " })).toBe(false)
    expect(journalFilters(scoped)).toMatchObject({ markedById: ID2, groupId: ID, gymId: undefined })
  })
})

describe("rows", () => {
  it("labels methods, an unrecorded one included", () => {
    expect(methodLabel("CASH")).toBe("Наличные")
    expect(methodLabel("CARD")).toBe("Карта в клубе")
    expect(methodLabel("ONLINE")).toBe("Онлайн")
    expect(methodLabel("NONE")).toBe("Не указан")
    expect(methodLabel(null)).toBe("Не указан")
  })

  it("marks an autopay renewal in the method", () => {
    const online = {
      paymentId: ID2,
      provider: "YOOKASSA" as const,
      providerRef: "ab12cd",
      status: "SUCCEEDED" as const,
      refundable: 4000,
    }
    expect(entryMethodLabel(entry({ method: "ONLINE", online: { ...online, autopay: true } }))).toBe(
      "Онлайн · автоплатёж",
    )
    expect(entryMethodLabel(entry({ method: "ONLINE", online: { ...online, autopay: false } }))).toBe("Онлайн")
    expect(entryMethodLabel(entry({ method: "CASH" }))).toBe("Наличные")
  })

  it("says what the money was for", () => {
    expect(entryWhat(entry())).toBe("Абонемент «БЖЖ 12»")
    expect(entryWhat(entry({ source: "ticket", itemName: "Семинар по гвардам" }))).toBe(
      "Событие «Семинар по гвардам»",
    )
    expect(entryWhat(entry({ kind: "refund", reason: "Переезд" }))).toBe("Возврат · Переезд")
  })

  it("draws refunds with a minus", () => {
    expect(plain(entryAmount(entry()))).toBe("4 000 ₽")
    expect(plain(entryAmount(entry({ kind: "refund", amount: 1000 })))).toBe("−1 000 ₽")
    expect(plain(entryTitle(entry()))).toBe("Оплата 4 000 ₽")
    expect(plain(entryTitle(entry({ kind: "refund", amount: 1000 })))).toBe("Возврат 1 000 ₽")
  })

  it("notes a partial refund under the payment only", () => {
    expect(refundedNote(entry())).toBeNull()
    expect(plain(refundedNote(entry({ refundedAmount: 1000 })))).toBe("возвращено 1 000 ₽")
    expect(refundedNote(entry({ kind: "refund", refundedAmount: 1000 }))).toBeNull()
  })

  it("notes a payment's discount under its amount, with who set the price", () => {
    const who = { userId: ID2, name: "Петров" }
    expect(entryDiscountNote(entry())).toBeNull()
    expect(
      plain(entryDiscountNote(entry({ listPrice: 4000, discountName: "Семейная", discountAmount: 400, pricedBy: who }))),
    ).toBe("скидка «Семейная» −400 ₽")
    expect(plain(entryDiscountNote(entry({ listPrice: 4000, oneOffDiscount: 1000, pricedBy: who })))).toBe(
      "Разовая скидка 1 000 ₽ · Петров",
    )
    expect(
      plain(
        entryDiscountNote(
          entry({
            listPrice: 4000,
            discountName: "ВЕСНА",
            discountAmount: 500,
            oneOffDiscount: 200,
            pricedBy: who,
          }),
        ),
      ),
    ).toBe("скидка «ВЕСНА» −500 ₽ и разовая 200 ₽ · Петров")
    // Online: nobody set the price by hand.
    expect(plain(entryDiscountNote(entry({ discountName: "ВЕСНА", discountAmount: 500 })))).toBe(
      "скидка «ВЕСНА» −500 ₽",
    )
    expect(entryDiscountNote(entry({ kind: "refund", oneOffDiscount: 1000 }))).toBeNull()
  })

  it("lists the price facts only when the list price is known", () => {
    expect(entryPriceFacts(entry())).toEqual([])
    expect(
      entryPriceFacts(entry({ amount: 3600, listPrice: 4000, discountName: "Семейная", discountAmount: 400 })).map(
        (f) => `${f.label}: ${plain(f.value)}`,
      ),
    ).toEqual(["Цена по тарифу: 4 000 ₽", "Скидка: «Семейная» −400 ₽", "Получено: 3 600 ₽"])
    expect(entryPriceFacts(entry({ source: "ticket", listPrice: 4000 }))[0].label).toBe("Цена билета")
  })

  it("shows the time on the club's clock, the year only when it differs", () => {
    const now = new Date("2026-11-15T09:00:00Z")
    expect(formatEntryAt("2026-11-03T15:40:00Z", "Europe/Moscow", now)).toBe("3 нояб., 18:40")
    expect(formatEntryAt("2026-11-03T15:40:00Z", "Asia/Tomsk", now)).toBe("3 нояб., 22:40")
    expect(formatEntryAt("2025-12-31T20:00:00Z", "Europe/Moscow", now)).toBe(
      "31 дек. 2025 г., 23:00",
    )
  })
})

describe("summary", () => {
  it("spells out received, refunded and the net", () => {
    const line = summaryLine(totals())
    expect(plain(line.before)).toBe("Получено 412 000 ₽ · возвращено 0 ₽ · итого ")
    expect(plain(line.net)).toBe("412 000 ₽")
    const refunded = summaryLine(totals({ refunded: 6000, net: 406000 }))
    expect(plain(refunded.before)).toBe("Получено 412 000 ₽ · возвращено 6 000 ₽ · итого ")
    expect(plain(refunded.net)).toBe("406 000 ₽")
  })

  it("draws a negative net (refunds only) with a minus", () => {
    expect(plain(summaryLine(totals({ received: 0, refunded: 1000, net: -1000 })).net)).toBe(
      "−1 000 ₽",
    )
  })

  it("lists the methods with money, in a fixed order, at their net", () => {
    expect(plain(methodsLine(totals()))).toBe(
      "Наличные 120 000 ₽ · Перевод 80 000 ₽ · Карта в клубе 40 000 ₽ · Онлайн 166 000 ₽",
    )
    expect(
      plain(
        methodsLine(
          totals({
            byMethod: [
              { method: "NONE", received: 5000, refunded: 0, count: 1 },
              { method: "CASH", received: 4000, refunded: 1000, count: 1 },
              { method: "CARD", received: 0, refunded: 0, count: 0 },
            ],
          }),
        ),
      ),
    ).toBe("Наличные 3 000 ₽ · Не указан 5 000 ₽")
    expect(methodsLine(totals({ byMethod: [] }))).toBeNull()
  })

  it("adds the discounts given only when there are any, apart from the net", () => {
    expect(discountsLine(totals())).toBeNull()
    expect(
      plain(discountsLine(totals({ discounted: { count: 31, amount: 12400, oneOffAmount: 3400 } }))),
    ).toBe("Скидки: 12 400 ₽ по 31 оплате, из них разовые 3 400 ₽")
    expect(plain(discountsLine(totals({ discounted: { count: 2, amount: 800, oneOffAmount: 0 } })))).toBe(
      "Скидки: 800 ₽ по 2 оплатам",
    )
  })

  it("titles the unapplied strip with its count", () => {
    expect(unappliedTitle(2)).toBe("Оплачено онлайн, но не зачислено · 2")
  })
})

describe("refund form", () => {
  const online = {
    paymentId: ID2,
    provider: "YOOKASSA" as const,
    providerRef: "ab12cd",
    status: "SUCCEEDED" as const,
    refundable: 4000,
    autopay: false,
  }
  const detail = (patch: Partial<PaymentJournalEntryDetail> = {}): PaymentJournalEntryDetail => ({
    ...entry(),
    refunds: [],
    memberHasCard: true,
    fullRefundCancelsRegistration: false,
    cardLabel: null,
    ...patch,
  })
  const sale = (patch: Partial<PaymentJournalEntryDetail> = {}): RefundSubject => ({
    kind: "sale",
    entry: detail(patch),
  })
  const unapplied: RefundSubject = {
    kind: "unapplied",
    payment: {
      paymentId: ID2,
      at: "2026-11-03T15:40:00.000Z",
      member: { userId: ID, name: "Иван Петров", isMember: true },
      itemName: "БЖЖ 12",
      amount: 4000,
      refundable: 4000,
      currency: "RUB",
      provider: "STRIPE",
      activationError: "Тариф выключен",
    } satisfies PaymentJournalUnapplied,
  }

  it("targets the sale, or the payment that never became one", () => {
    expect(refundTargetOf(sale())).toEqual({ target: "abonement", targetId: ID })
    expect(
      refundTargetOf(
        sale({ source: "ticket", subscriptionId: null, eventRegistrationId: ID2, eventId: ID }),
      ),
    ).toEqual({ target: "ticket", targetId: ID2 })
    expect(refundTargetOf(unapplied)).toEqual({ target: "unapplied", targetId: ID2 })
    // A refund row is no sale.
    expect(refundTargetOf(sale({ kind: "refund", refundable: 0 }))).toBeNull()
    expect(subjectRefundable(sale({ kind: "refund", refundable: 1000 }))).toBe(0)
  })

  it("offers online first only while the provider can still return money", () => {
    expect(refundMethods(sale())).toEqual(["CASH", "TRANSFER", "CARD"])
    expect(defaultRefundMethod(sale({ method: "TRANSFER" }))).toBe("TRANSFER")
    expect(defaultRefundMethod(sale({ method: null }))).toBe("CASH")

    const paidOnline = sale({ method: "ONLINE", online })
    expect(refundMethods(paidOnline)).toEqual(["ONLINE", "CASH", "TRANSFER", "CARD"])
    expect(defaultRefundMethod(paidOnline)).toBe("ONLINE")

    const returned = sale({ method: "ONLINE", online: { ...online, status: "REFUNDED", refundable: 0 } })
    expect(onlineRefundable(returned)).toBe(0)
    expect(refundMethods(returned)).toEqual(["CASH", "TRANSFER", "CARD"])
    expect(defaultRefundMethod(returned)).toBe("CASH")

    // An unapplied payment goes back online only.
    expect(refundMethods(unapplied)).toEqual(["ONLINE"])
    expect(defaultRefundMethod(unapplied)).toBe("ONLINE")
  })

  it("names the provider on the online method", () => {
    expect(refundMethodLabel("ONLINE", "YOOKASSA")).toBe("На карту через ЮKassa")
    expect(refundMethodLabel("ONLINE", "STRIPE")).toBe("На карту через Stripe")
    expect(refundMethodLabel("CARD", null)).toBe("Карта в клубе")
  })

  it("caps the amount at what is left, online also at the provider's side", () => {
    const partly = sale({ method: "ONLINE", refundedAmount: 1000, refundable: 3000, online: { ...online, refundable: 2500 } })
    expect(refundMax(partly, "CASH")).toBe(3000)
    expect(refundMax(partly, "ONLINE")).toBe(2500)
    expect(parseRefundAmount("3 000", partly, "CASH")).toEqual({ amount: 3000 })
    const over = parseRefundAmount("3000", partly, "ONLINE")
    expect("error" in over && plain(over.error)).toBe("Вернуть можно от 1 до 2 500 ₽")
    expect("error" in parseRefundAmount("0", partly, "CASH")).toBe(true)
    expect("error" in parseRefundAmount("10.5", partly, "CASH")).toBe(true)
  })

  it("hints only what is true", () => {
    expect(refundHint(sale(), 4000)).toBe(
      "Абонемент останется действующим — отменить его можно в карточке ученика",
    )
    // A refund leaves the autopay agreement on.
    expect(refundHint(sale({ method: "ONLINE", online: { ...online, autopay: true } }), 4000)).toBe(
      "Абонемент останется действующим — отменить его можно в карточке ученика. Автоплатёж останется включённым — отключить его можно в карточке ученика",
    )
    const ticket = sale({
      source: "ticket",
      subscriptionId: null,
      eventRegistrationId: ID2,
      fullRefundCancelsRegistration: true,
    })
    expect(refundHint(ticket, 4000)).toBe(
      "Запись на событие будет отменена, место перейдёт следующему в листе ожидания",
    )
    // A partial refund keeps the place; so does a past event.
    expect(refundHint(ticket, 1000)).toBeNull()
    expect(
      refundHint(
        sale({ source: "ticket", eventRegistrationId: ID2, fullRefundCancelsRegistration: false }),
        4000,
      ),
    ).toBeNull()
    expect(refundHint(unapplied, 4000)).toBeNull()
  })

  it("deletes only an offline refund's record", () => {
    expect(canDeleteRefund(entry({ kind: "refund", method: "CASH" }))).toBe(true)
    expect(canDeleteRefund(entry({ kind: "refund", method: "ONLINE" }))).toBe(false)
    expect(canDeleteRefund(entry())).toBe(false)
    expect(refundIdOf(`ref:${ID}`)).toBe(ID)
  })
})
