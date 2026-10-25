import type { AtRiskContact, AtRiskList } from "../../shared/api/retention"
import {
  applyContact,
  callListBody,
  callListTitle,
  contactLine,
  isStaffWorkspace,
  telUrl,
  visibleEntries,
} from "./retention-helpers"

const member = (
  userId: string,
  reason: AtRiskList["data"][number]["reason"],
  snoozed = false,
) => ({ userId, reason, snoozed, lastContact: null }) as AtRiskList["data"][number]

const list = (): AtRiskList => ({
  data: [
    member("a", "lapsed"),
    member("b", "absent"),
    member("c", "absent", true),
  ],
  summary: {
    total: 2,
    lapsed: 1,
    newcomer: 0,
    absent: 1,
    declining: 0,
    snoozed: 1,
  },
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

describe("callListTitle / callListBody", () => {
  it("declines the student count", () => {
    expect(callListTitle(1)).toBe("Позвонить: 1 ученику")
    expect(callListTitle(5)).toBe("Позвонить: 5 ученикам")
  })

  it("lists the non-zero reasons in priority order", () => {
    expect(
      callListBody({
        total: 6,
        lapsed: 2,
        newcomer: 0,
        absent: 3,
        declining: 1,
        snoozed: 0,
      }),
    ).toBe("кончился абонемент: 2 · давно не были: 3 · ходят реже: 1")
  })
})

describe("telUrl", () => {
  it("keeps only digits and the plus", () => {
    expect(telUrl("+7 (900) 000-00-00")).toBe("tel:+79000000000")
  })
})

describe("visibleEntries", () => {
  it("hides snoozed members unless asked", () => {
    expect(visibleEntries(list(), null, false).map((m) => m.userId)).toEqual([
      "a",
      "b",
    ])
    expect(visibleEntries(list(), null, true)).toHaveLength(3)
  })

  it("filters by reason", () => {
    expect(visibleEntries(list(), "absent", true).map((m) => m.userId)).toEqual([
      "b",
      "c",
    ])
  })
})

describe("applyContact", () => {
  it("snoozes the member, stores the contact and recounts", () => {
    const c = contact()
    const out = applyContact(list(), "b", c)!
    const b = out.data.find((m) => m.userId === "b")!
    expect(b.snoozed).toBe(true)
    expect(b.lastContact).toEqual(c)
    expect(out.summary).toEqual({
      total: 1,
      lapsed: 1,
      newcomer: 0,
      absent: 0,
      declining: 0,
      snoozed: 2,
    })
  })

  it("leaves other members and a missing list alone", () => {
    expect(applyContact(null, "b", contact())).toBeNull()
    const out = applyContact(list(), "zzz", contact())!
    expect(out.summary.total).toBe(2)
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
