import { activeTabKey, visibleTabs, type SectionTab } from "./section-tabs"

const base = "/workspace/w1"
const tabs: SectionTab[] = [
  { key: "plans", label: "Тарифы", path: "subscriptions", access: "clubAdmin" },
  { key: "payments", label: "Платежи", path: "subscriptions/payments", access: "clubAdmin" },
  { key: "belts", label: "Лестницы", path: "ranks", access: "lead", feature: "ranks" },
]

describe("section tabs", () => {
  it("lights the longest matching tab, nested routes included", () => {
    expect(activeTabKey(tabs, base, `${base}/subscriptions`)).toBe("plans")
    expect(activeTabKey(tabs, base, `${base}/subscriptions/payments`)).toBe("payments")
    expect(activeTabKey(tabs, base, `${base}/subscriptions/plans/p1`)).toBe("plans")
    expect(activeTabKey(tabs, base, `${base}/subscriptionsx`)).toBeNull()
    expect(activeTabKey(tabs, base, null)).toBeNull()
  })

  it("keeps the tabs the role may open in a club that has the section on", () => {
    const admin = { role: "admin", isOwner: false, managedDirectionIds: [] }
    const headCoach = { role: "head_coach", isOwner: false, managedDirectionIds: [] }
    const ranksOff = { ranks: false } as Parameters<typeof visibleTabs>[2]
    expect(visibleTabs(tabs, admin, null).map((t) => t.key)).toEqual(["plans", "payments", "belts"])
    expect(visibleTabs(tabs, headCoach, null).map((t) => t.key)).toEqual(["belts"])
    expect(visibleTabs(tabs, admin, ranksOff).map((t) => t.key)).toEqual(["plans", "payments"])
    expect(visibleTabs(tabs, null, null)).toEqual([])
  })
})
