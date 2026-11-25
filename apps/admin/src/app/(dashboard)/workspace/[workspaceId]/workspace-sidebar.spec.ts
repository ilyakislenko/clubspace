import { vocabularyForWorkspaceType } from "@clubspace/ui-kit/brand"

import type { CurrentMembership } from "../../../../shared/lib/permissions"
import type { WorkspaceFeatures } from "../../../../shared/lib/use-workspace-features"
import { navGroups, resolveNavItems } from "./workspace-sidebar"

const allItems = navGroups(vocabularyForWorkspaceType(null)).flatMap((g) => g.items)
const resolve = (m: CurrentMembership | null, features: WorkspaceFeatures | null = null) =>
  resolveNavItems(allItems, m, features)
const visibleKeys = (m: CurrentMembership | null) => resolve(m).map((item) => item.key)
const itemOf = (m: CurrentMembership | null, key: string) =>
  resolve(m).find((item) => item.key === key)

const m = (
  role: string,
  isOwner = false,
  managedDirectionIds: string[] = [],
): CurrentMembership => ({ role, isOwner, managedDirectionIds })

const DAILY = ["dashboard", "schedule", "users", "retention"]
const SPORT = [...DAILY, "reports", "groups", "belts", "content", "news"]

describe("workspace sidebar", () => {
  it("shows the owner and admin every item, at most 12", () => {
    const all = allItems.map((item) => item.key)
    expect(visibleKeys(m("user", true))).toEqual(all)
    expect(visibleKeys(m("admin"))).toEqual(all)
    expect(all.length).toBeLessThanOrEqual(12)
  })

  it("shows head_coach no money or system items, reports without money tabs", () => {
    expect(visibleKeys(m("head_coach"))).toEqual(SPORT)
    expect(itemOf(m("head_coach"), "reports")).toMatchObject({
      path: "analytics/occupancy",
      matchPaths: [
        "analytics/occupancy",
        "analytics/coaches",
        "analytics/cohorts",
        "analytics/trials",
        "ai-assistant",
      ],
    })
  })

  it("opens a club admin's reports on revenue", () => {
    expect(itemOf(m("admin"), "reports")?.path).toBe("analytics/forecast")
    expect(itemOf(m("admin"), "subscriptions")?.matchPaths).toEqual([
      "subscriptions",
      "subscriptions/discounts",
      "subscriptions/payments",
    ])
  })

  it("shows a direction manager the sport items, reports without the coaches comparison", () => {
    expect(visibleKeys(m("coach", false, ["bjj"]))).toEqual(SPORT)
    expect(itemOf(m("coach", false, ["bjj"]), "reports")?.matchPaths).not.toContain(
      "analytics/coaches",
    )
  })

  it("shows a plain coach only the daily items", () => {
    expect(visibleKeys(m("coach"))).toEqual(DAILY)
    expect(visibleKeys(null)).toEqual(DAILY)
  })

  it("hides a section the club switched off", () => {
    const features = { ranks: false, videos: false } as WorkspaceFeatures
    const keys = resolve(m("admin"), features).map((item) => item.key)
    expect(keys).not.toContain("belts")
    expect(keys).not.toContain("content")
  })
})
