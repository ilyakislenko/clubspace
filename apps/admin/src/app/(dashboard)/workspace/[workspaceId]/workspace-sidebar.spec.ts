import { vocabularyForWorkspaceType } from "@clubspace/ui-kit/brand"

import {
  visibleNavItems,
  type CurrentMembership,
} from "../../../../shared/lib/permissions"
import {
  analyticsNavItems,
  dailyNavItems,
  manageNavItems,
} from "./workspace-sidebar"

const vocabulary = vocabularyForWorkspaceType(null)
const allItems = [
  ...dailyNavItems,
  ...analyticsNavItems(vocabulary),
  ...manageNavItems(vocabulary),
]
const visibleKeys = (m: CurrentMembership | null) =>
  visibleNavItems(allItems, m).map((item) => item.key)

const m = (
  role: string,
  isOwner = false,
  managedDirectionIds: string[] = [],
): CurrentMembership => ({ role, isOwner, managedDirectionIds })

const SPORT_KEYS = [
  "dashboard",
  "retention",
  "analytics-cohorts",
  "analytics-occupancy",
  "analytics-coaches",
  "ai-assistant",
  "users",
  "groups",
  "schedule",
  "content",
  "ranks",
  "gradings",
  "events",
  "announcements",
  "achievements",
]

describe("workspace sidebar visibility", () => {
  it("shows every item to the owner and to admin", () => {
    const all = allItems.map((item) => item.key)
    expect(visibleKeys(m("user", true))).toEqual(all)
    expect(visibleKeys(m("admin"))).toEqual(all)
  })

  it("shows head_coach no money or system items", () => {
    expect(visibleKeys(m("head_coach"))).toEqual(SPORT_KEYS)
  })

  it("shows a direction manager the sport items except the coaches comparison", () => {
    expect(visibleKeys(m("coach", false, ["bjj"]))).toEqual(
      SPORT_KEYS.filter((key) => key !== "analytics-coaches"),
    )
  })

  it("shows a plain coach only the daily items", () => {
    const daily = ["dashboard", "retention", "users", "schedule"]
    expect(visibleKeys(m("coach"))).toEqual(daily)
    expect(visibleKeys(null)).toEqual(daily)
  })
})
