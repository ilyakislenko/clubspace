import type {
  AtRiskContact,
  AtRiskList,
  AtRiskMember,
  AtRiskSummary,
} from "../../shared/api/retention"
import {
  applyContact,
  callContact,
  callListKey,
  callListReason,
  callListSummaryKey,
  callListTitle,
  contactLine,
  isStaffWorkspace,
  mergePages,
} from "./retention-helpers"

const member = (
  userId: string,
  reason: AtRiskMember["reason"],
  over: Partial<AtRiskMember> = {},
) =>
  ({
    userId,
    reason,
    snoozed: false,
    lastContact: null,
    level: null,
    monthlySpend: null,
    ...over,
  }) as AtRiskMember

// The first page of «to call»: two of the three; one more is snoozed.
const list = (moneyAtStake: number | null = 8000): AtRiskList => ({
  data: [
    member("a", "lapsed", { level: "high", monthlySpend: 5000 }),
    member("b", "absent", { monthlySpend: 3000 }),
  ],
  summary: {
    total: 3,
    lapsed: 1,
    newcomer: 0,
    absent: 2,
    declining: 0,
    high: 1,
    snoozed: 1,
    moneyAtStake,
    currency: "RUB",
  },
  total: 3,
  page: 1,
  perPage: 2,
  scoredAt: null,
})

const contact = (over: Partial<AtRiskContact> = {}): AtRiskContact => ({
  id: "c1",
  userId: "b",
  at: "2026-10-24T12:00:00.000Z",
  byName: "Иван Тренер",
  note: null,
  reason: "absent",
  signals: ["absent"],
  ...over,
})

describe("isStaffWorkspace", () => {
  it("passes the owner and the staff roles", () => {
    expect(isStaffWorkspace({ roleName: "user", isOwner: true })).toBe(true)
    for (const roleName of ["coach", "head_coach", "admin"]) {
      expect(isStaffWorkspace({ roleName, isOwner: false })).toBe(true)
    }
  })

  it("refuses a plain member and a missing workspace", () => {
    expect(isStaffWorkspace({ roleName: "user", isOwner: false })).toBe(false)
    expect(isStaffWorkspace(null)).toBe(false)
  })
})

describe("callListTitle / callListReason", () => {
  const summary = (over: Partial<AtRiskSummary>): AtRiskSummary => ({
    total: 0,
    lapsed: 0,
    newcomer: 0,
    absent: 0,
    declining: 0,
    high: 0,
    snoozed: 0,
    moneyAtStake: null,
    currency: null,
    ...over,
  })

  it("declines the student count", () => {
    expect(callListTitle(1)).toBe("1 ученику стоит позвонить")
    expect(callListTitle(5)).toBe("5 ученикам стоит позвонить")
    expect(callListTitle(21)).toBe("21 ученику стоит позвонить")
  })

  it("names only the biggest reason", () => {
    expect(
      callListReason(summary({ total: 6, lapsed: 2, absent: 3, declining: 1 })),
    ).toBe("3 давно не были")
    expect(callListReason(summary({ total: 10, lapsed: 10 }))).toBe(
      "у 10 кончился абонемент",
    )
    expect(callListReason(summary({ total: 1, declining: 1 }))).toBe(
      "1 ходит реже",
    )
  })

  it("breaks a tie by priority", () => {
    expect(callListReason(summary({ total: 8, newcomer: 4, absent: 4 }))).toBe(
      "4 новичка",
    )
  })

  it("is null without a counted reason", () => {
    expect(callListReason(summary({}))).toBeNull()
  })
})

describe("cache keys", () => {
  it("keeps every view under the club's atrisk resource", () => {
    expect(callListSummaryKey("w1")).toBe("atrisk:w1:summary")
    expect(callListKey("w1", false, null)).toBe("atrisk:w1:open:all")
    expect(callListKey("w1", false, "lapsed")).toBe("atrisk:w1:open:lapsed")
    expect(callListKey("w1", true, null)).toBe("atrisk:w1:snoozed:all")
  })
})

describe("mergePages", () => {
  it("appends the next pages and shows a member once", () => {
    const merged = mergePages(
      [member("a", "lapsed"), member("b", "absent")],
      [member("b", "absent"), member("c", "declining")],
    )
    expect(merged.map((m) => m.userId)).toEqual(["a", "b", "c"])
  })

  it("shows no row twice after a contact shifts the pages under «Показать ещё»", () => {
    const PER_PAGE = 50
    let server = Array.from({ length: 120 }, (_, i) => member(`u${i}`, "absent"))
    const page = (n: number) => server.slice((n - 1) * PER_PAGE, n * PER_PAGE)
    // Two pages on screen.
    let first = page(1)
    let more = page(2)
    // «Связались» on page 1: off the list, page 1 refetched.
    server = server.filter((m) => m.userId !== "u3")
    first = page(1)
    more = more.filter((m) => m.userId !== "u3")
    // «Показать ещё» asks for the page after what is shown.
    const shown = mergePages(first, more).length
    more = [...more, ...page(Math.floor(shown / PER_PAGE) + 1)]
    const ids = mergePages(first, more).map((m) => m.userId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(100)
    expect(ids).not.toContain("u3")
  })
})

describe("applyContact", () => {
  it("takes the member off the list and moves every count by one", () => {
    const out = applyContact(list(), "a")!
    expect(out.data.map((m) => m.userId)).toEqual(["b"])
    expect(out.total).toBe(2)
    expect(out.summary).toEqual({
      total: 2,
      lapsed: 0,
      newcomer: 0,
      absent: 2,
      declining: 0,
      high: 0,
      snoozed: 2,
      moneyAtStake: 3000,
      currency: "RUB",
    })
  })

  it("keeps hidden money hidden", () => {
    expect(applyContact(list(null), "b")!.summary.moneyAtStake).toBeNull()
  })

  it("leaves an unknown member and a missing list alone", () => {
    expect(applyContact(null, "b")).toBeNull()
    const prev = list()
    expect(applyContact(prev, "zzz")).toBe(prev)
  })
})

describe("contactLine", () => {
  const now = new Date("2026-10-25T12:00:00Z")

  it("says who and when", () => {
    expect(contactLine(contact(), now)).toBe("Связались вчера: Иван Тренер")
  })

  it("appends the note", () => {
    expect(contactLine(contact({ note: "вернётся" }), now)).toBe(
      "Связались вчера: Иван Тренер — «вернётся»",
    )
  })

  it("counts days then weeks", () => {
    expect(contactLine(contact({ at: "2026-10-25T08:00:00.000Z" }), now)).toContain(
      "сегодня",
    )
    expect(contactLine(contact({ at: "2026-10-20T12:00:00.000Z" }), now)).toContain(
      "5 дн. назад",
    )
    expect(contactLine(contact({ at: "2026-10-11T12:00:00.000Z" }), now)).toContain(
      "2 нед. назад",
    )
  })
})

describe("callContact", () => {
  type Guardian = AtRiskMember["guardians"][number]
  const guardian = (over: Partial<Guardian>): Guardian => ({
    userId: "g",
    firstname: "Анна",
    lastname: "Иванова",
    email: "anna@example.com",
    phone: "+79990000001",
    relation: "PARENT",
    confirmed: true,
    ...over,
  })

  it("calls the member themselves when they have no guardians", () => {
    expect(
      callContact({ phone: "+79990000000", email: "m@example.com", guardians: [] }),
    ).toEqual({ phone: "+79990000000", email: "m@example.com", guardian: null })
  })

  it("calls a child's parent, with the parent's name, phone and e-mail", () => {
    expect(
      callContact({ phone: null, email: null, guardians: [guardian({})] }),
    ).toEqual({
      phone: "+79990000001",
      email: "anna@example.com",
      guardian: { name: "Анна Иванова", label: "Родитель" },
    })
  })

  it("prefers a confirmed guardian, then one with a phone", () => {
    const pending = guardian({ userId: "p", firstname: "Пётр", confirmed: false })
    const noPhone = guardian({ userId: "n", firstname: "Нина", phone: null })
    const withPhone = guardian({
      userId: "w",
      firstname: "Вера",
      lastname: null,
      relation: "GUARDIAN",
    })
    expect(
      callContact({ phone: null, email: null, guardians: [pending, noPhone, withPhone] })
        .guardian,
    ).toEqual({ name: "Вера", label: "Опекун" })
  })

  it("marks a guardian who hasn't confirmed yet and falls back to the e-mail as a name", () => {
    expect(
      callContact({
        phone: null,
        email: null,
        guardians: [
          guardian({ firstname: null, lastname: null, confirmed: false, relation: "OTHER" }),
        ],
      }).guardian,
    ).toEqual({ name: "anna@example.com", label: "Представитель (не подтвердил)" })
  })
})
