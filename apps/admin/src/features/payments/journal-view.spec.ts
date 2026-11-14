import type {
  PaymentJournalEntry,
  PaymentJournalTotals,
} from "../../shared/api/payment-journal"
import { ANALYTICS_ALL } from "../../shared/lib/analytics"
import {
  EMPTY_JOURNAL_STATE,
  canRefundOnline,
  clubToday,
  customRangeError,
  emptyText,
  entryAmount,
  entryTitle,
  entryWhat,
  formatEntryAt,
  isFiltered,
  journalFilters,
  journalSearch,
  methodLabel,
  methodsLine,
  panelFilterCount,
  parseJournalSearch,
  periodOf,
  presetRange,
  refundedNote,
  summaryLine,
  unappliedTitle,
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
      markedById: undefined,
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
      markedById: ID2,
      scope: { gymId: ANALYTICS_ALL, directionId: ID, groupId: ANALYTICS_ALL, coachId: ANALYTICS_ALL },
      q: " Иван ",
      entry: `sub:${ID}`,
    }
    const search = journalSearch(state)
    expect(search).toBe(
      `?from=2026-11-01&to=2026-11-15&method=CASH&markedById=${ID2}&directionId=${ID}&q=%D0%98%D0%B2%D0%B0%D0%BD&entry=sub%3A${ID}`,
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
        "?from=2026-11-15&to=2026-11-01&method=CHEQUE&markedById=x&gymId=1&entry=sub:nope",
      ),
    ).toEqual(EMPTY_JOURNAL_STATE)
    // One date alone is no range.
    expect(parseJournalSearch("?from=2026-11-01").from).toBeNull()
    expect(parseJournalSearch(`?q=${"я".repeat(150)}`).q).toHaveLength(100)
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

  it("offers an online refund only while the provider can make it", () => {
    const online = {
      paymentId: ID2,
      provider: "YOOKASSA" as const,
      providerRef: "ab12cd",
      status: "SUCCEEDED" as const,
    }
    expect(canRefundOnline(entry())).toBe(false)
    expect(canRefundOnline(entry({ method: "ONLINE", online }))).toBe(true)
    expect(canRefundOnline(entry({ online: { ...online, status: "REFUNDED" } }))).toBe(false)
    expect(canRefundOnline(entry({ online, refundable: 0 }))).toBe(false)
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
  it("leads with the net and the number of payments", () => {
    const line = summaryLine(totals())
    expect(line.before).toBe("Итого ")
    expect(plain(line.net)).toBe("412 000 ₽")
    expect(line.after).toBe(" · 37 оплат")
    expect(summaryLine(totals({ byMethod: [{ method: "CASH", received: 1, refunded: 0, count: 1 }] })).after).toBe(
      " · 1 оплата",
    )
    expect(summaryLine(totals({ byMethod: [{ method: "CASH", received: 1, refunded: 0, count: 22 }] })).after).toBe(
      " · 22 оплаты",
    )
  })

  it("spells out received and refunded once there are refunds", () => {
    const line = summaryLine(totals({ refunded: 6000, net: 406000 }))
    expect(plain(line.before)).toBe("Получено 412 000 ₽ · возвращено 6 000 ₽ · итого ")
    expect(plain(line.net)).toBe("406 000 ₽")
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

  it("titles the unapplied strip with its count", () => {
    expect(unappliedTitle(2)).toBe("Оплачено онлайн, но не зачислено · 2")
  })
})
