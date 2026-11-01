import type { MyDependent } from "../../shared/api/dependents"
import {
  dependentName,
  formatBirthDate,
  maskBirthDate,
  parseBirthDate,
  pendingInvites,
  reconcileActingAs,
  switchableDependents,
  todayYmd,
} from "./children-helpers"

const kid = (over: Partial<MyDependent>): MyDependent => ({
  id: "k1",
  firstname: "Миша",
  lastname: "Иванов",
  dateOfBirth: "2015-03-07",
  relation: "PARENT",
  status: "ACTIVE",
  consentAt: "2026-01-01T00:00:00.000Z",
  consentVersion: "1",
  invitedBy: null,
  clubs: [],
  ...over,
})

describe("switchable / pending", () => {
  it("splits confirmed children from club invitations", () => {
    const list = [
      kid({ id: "a" }),
      kid({ id: "b", status: "PENDING" }),
      kid({ id: "c" }),
    ]
    expect(switchableDependents(list).map((d) => d.id)).toEqual(["a", "c"])
    expect(pendingInvites(list).map((d) => d.id)).toEqual(["b"])
  })
})

describe("dependentName", () => {
  it("joins the parts and never renders empty", () => {
    expect(dependentName({ firstname: "Миша", lastname: null })).toBe("Миша")
    expect(dependentName({ firstname: "Миша", lastname: "Иванов" })).toBe(
      "Миша Иванов",
    )
    expect(dependentName({ firstname: null, lastname: null })).toBe("Ребёнок")
  })
})

describe("reconcileActingAs", () => {
  const acting = { id: "k1", firstname: "Миша", lastname: null }

  it("stays on a confirmed child, picking up a new name", () => {
    expect(
      reconcileActingAs(acting, [kid({ firstname: "Михаил", lastname: "И" })]),
    ).toEqual({ id: "k1", firstname: "Михаил", lastname: "И" })
  })

  it("falls back to the guardian when the child is gone or not confirmed", () => {
    expect(reconcileActingAs(acting, [])).toBeNull()
    expect(reconcileActingAs(acting, [kid({ id: "other" })])).toBeNull()
    expect(reconcileActingAs(acting, [kid({ status: "PENDING" })])).toBeNull()
  })

  it("keeps the guardian as the guardian", () => {
    expect(reconcileActingAs(null, [kid({})])).toBeNull()
  })
})

describe("birth dates", () => {
  const today = "2026-11-01"

  it("parses ДД.ММ.ГГГГ with any common separator", () => {
    expect(parseBirthDate("07.03.2015", today)).toBe("2015-03-07")
    expect(parseBirthDate("7/3/2015", today)).toBe("2015-03-07")
    expect(parseBirthDate(" 07-03-2015 ", today)).toBe("2015-03-07")
    expect(parseBirthDate("29.02.2016", today)).toBe("2016-02-29")
  })

  it("rejects impossible, future and malformed dates", () => {
    expect(parseBirthDate("31.02.2015", today)).toBeNull()
    expect(parseBirthDate("29.02.2015", today)).toBeNull()
    expect(parseBirthDate("01.13.2015", today)).toBeNull()
    expect(parseBirthDate("02.11.2026", today)).toBeNull()
    expect(parseBirthDate("01.01.1899", today)).toBeNull()
    expect(parseBirthDate("2015-03-07", today)).toBeNull()
    expect(parseBirthDate("", today)).toBeNull()
  })

  it("accepts today", () => {
    expect(parseBirthDate("01.11.2026", today)).toBe("2026-11-01")
  })

  it("formats YYYY-MM-DD for display", () => {
    expect(formatBirthDate("2015-03-07")).toBe("07.03.2015")
    expect(formatBirthDate(null)).toBe("")
  })

  it("masks digits as they are typed", () => {
    expect(maskBirthDate("07")).toBe("07")
    expect(maskBirthDate("0703")).toBe("07.03")
    expect(maskBirthDate("070320")).toBe("07.03.20")
    expect(maskBirthDate("0703201599")).toBe("07.03.2015")
    expect(maskBirthDate("07.03")).toBe("07.03")
    expect(maskBirthDate("07.032")).toBe("07.03.2")
    expect(maskBirthDate("07.0")).toBe("07.0")
    expect(maskBirthDate("7/3/2015")).toBe("7/3/2015")
    expect(maskBirthDate("7.3.2015")).toBe("7.3.2015")
  })

  it("reads today off the device calendar", () => {
    expect(todayYmd(new Date(2026, 10, 1, 23, 59))).toBe("2026-11-01")
  })
})
