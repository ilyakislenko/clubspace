import type { AtRiskMember } from "../api/retention"
import { AT_RISK_CHIP, AT_RISK_LABEL, filterAtRisk } from "./at-risk"

const member = (
  userId: string,
  reason: AtRiskMember["reason"],
  snoozed = false,
) => ({ userId, reason, snoozed }) as AtRiskMember

const data = [
  member("a", "lapsed"),
  member("b", "absent"),
  member("c", "absent", true),
  member("d", "declining"),
]

describe("filterAtRisk", () => {
  it("hides snoozed members by default", () => {
    expect(filterAtRisk(data, null, false).map((m) => m.userId)).toEqual([
      "a",
      "b",
      "d",
    ])
  })

  it("includes snoozed members when asked", () => {
    expect(filterAtRisk(data, null, true)).toHaveLength(4)
  })

  it("filters by reason", () => {
    expect(filterAtRisk(data, "absent", false).map((m) => m.userId)).toEqual([
      "b",
    ])
    expect(filterAtRisk(data, "absent", true).map((m) => m.userId)).toEqual([
      "b",
      "c",
    ])
  })

  it("returns nothing for a reason nobody has", () => {
    expect(filterAtRisk(data, "newcomer", true)).toEqual([])
  })
})

describe("at-risk labels", () => {
  it("covers every reason with a label and a chip class", () => {
    for (const r of ["lapsed", "newcomer", "absent", "declining"] as const) {
      expect(AT_RISK_LABEL[r]).toBeTruthy()
      expect(AT_RISK_CHIP[r]).toBeTruthy()
    }
  })
})
