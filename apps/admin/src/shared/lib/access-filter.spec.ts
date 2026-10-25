import { matchesAccessFilter } from "./access-filter"

const DAY = 24 * 3600 * 1000
const iso = (offsetDays: number): string =>
  new Date(Date.now() + offsetDays * DAY).toISOString()

const student = {
  isOwner: false,
  roleName: "user",
  status: "ACTIVE",
  accessUntil: iso(5),
  lastCheckInAt: null as string | null,
}

describe("matchesAccessFilter", () => {
  it("'all' keeps everyone", () => {
    expect(
      matchesAccessFilter({ ...student, roleName: "coach", isOwner: true }, "all"),
    ).toBe(true)
  })

  it("matches a student in each segment", () => {
    expect(matchesAccessFilter(student, "expiring")).toBe(true)
    expect(matchesAccessFilter({ ...student, accessUntil: iso(-1) }, "expired")).toBe(true)
    expect(matchesAccessFilter(student, "inactive")).toBe(true)
    expect(
      matchesAccessFilter({ ...student, lastCheckInAt: iso(-2) }, "inactive"),
    ).toBe(false)
  })

  it.each(["admin", "head_coach", "coach"])(
    "keeps a %s out of every segment, like the server counters",
    (roleName) => {
      const staff = { ...student, roleName, accessUntil: iso(-1) }
      expect(matchesAccessFilter(staff, "expired")).toBe(false)
      expect(matchesAccessFilter({ ...staff, accessUntil: iso(5) }, "expiring")).toBe(false)
      expect(matchesAccessFilter(staff, "inactive")).toBe(false)
    },
  )

  it("keeps the owner out of every segment", () => {
    expect(matchesAccessFilter({ ...student, isOwner: true }, "inactive")).toBe(false)
  })
})
