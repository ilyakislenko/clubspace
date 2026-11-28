import { vocabularyForWorkspaceType } from "@clubspace/ui-kit/brand"

import { ORG_NAV } from "../../app/(dashboard)/org/[orgId]/org-sidebar"
import { navGroups } from "../../app/(dashboard)/workspace/[workspaceId]/workspace-sidebar"
import { settingsSections } from "../settings/SettingsNav"
import {
  GUIDE_IDS,
  helpEntryFor,
  matchHelpRoute,
  orgHelp,
  workspaceHelp,
} from "./help-entries"

const academy = vocabularyForWorkspaceType("GRAPPLING")
const studio = vocabularyForWorkspaceType("YOGA")
const workspace = workspaceHelp(academy)
const org = orgHelp()
const patterns = { workspace: Object.keys(workspace), org: Object.keys(org) }
const W = "/workspace/7f0c2a4e-1111-4222-8333-444455556666"
const O = "/org/0b1d9e6c-1111-4222-8333-444455556666"
const ID = "a1b2c3d4-1111-4222-8333-444455556666"

describe("matchHelpRoute", () => {
  it("matches the club's landing page and its sections", () => {
    expect(matchHelpRoute(W, patterns)).toEqual({ area: "workspace", pattern: "" })
    expect(matchHelpRoute(`${W}/`, patterns)).toEqual({ area: "workspace", pattern: "" })
    expect(matchHelpRoute(`${W}/schedule`, patterns)).toEqual({ area: "workspace", pattern: "schedule" })
  })

  it("matches tab sub-routes before the id pages beside them", () => {
    expect(matchHelpRoute(`${W}/users/requests`, patterns)?.pattern).toBe("users/requests")
    expect(matchHelpRoute(`${W}/users/trials`, patterns)?.pattern).toBe("users/trials")
    expect(matchHelpRoute(`${W}/users/${ID}`, patterns)?.pattern).toBe("users/*")
    expect(matchHelpRoute(`${W}/subscriptions/payments`, patterns)?.pattern).toBe("subscriptions/payments")
    expect(matchHelpRoute(`${W}/subscriptions/plans/${ID}`, patterns)?.pattern).toBe("subscriptions/plans/*")
    expect(matchHelpRoute(`${W}/analytics/forecast`, patterns)?.pattern).toBe("analytics/forecast")
    expect(matchHelpRoute(`${W}/settings/access`, patterns)?.pattern).toBe("settings/access")
  })

  it("tells the federation console from the club", () => {
    expect(matchHelpRoute(O, patterns)).toEqual({ area: "org", pattern: "" })
    expect(matchHelpRoute(`${O}/settings`, patterns)).toEqual({ area: "org", pattern: "settings" })
    expect(matchHelpRoute(`${W}/settings`, patterns)).toEqual({ area: "workspace", pattern: "settings" })
    expect(matchHelpRoute(`${O}/events/${ID}/tournament`, patterns)?.pattern).toBe("events/*/tournament")
    expect(matchHelpRoute(`${O}/events/${ID}/tournament/divisions/${ID}`, patterns)?.pattern).toBe(
      "events/*/tournament/divisions/*",
    )
    // A club-only section is not a federation page.
    expect(matchHelpRoute(`${O}/schedule`, patterns)).toBeNull()
  })

  it("answers null for unknown routes and pages outside both shells", () => {
    expect(matchHelpRoute(`${W}/nope`, patterns)).toBeNull()
    expect(matchHelpRoute(`${W}/schedule/extra`, patterns)).toBeNull()
    expect(matchHelpRoute(`${W}/users/${ID}/extra`, patterns)).toBeNull()
    // Legacy routes that only redirect.
    expect(matchHelpRoute(`${W}/achievements`, patterns)).toBeNull()
    expect(matchHelpRoute("/workspace", patterns)).toBeNull()
    expect(matchHelpRoute("/platform", patterns)).toBeNull()
    expect(matchHelpRoute("/workspaces", patterns)).toBeNull()
    expect(matchHelpRoute(null, patterns)).toBeNull()
  })

  it("helpEntryFor returns the entry in the club's words", () => {
    expect(helpEntryFor(`${W}/schedule`, academy)?.title).toBe("Расписание")
    expect(helpEntryFor(`${W}/analytics/coaches`, academy)?.title).toBe("Отчёты → Тренеры")
    expect(helpEntryFor(`${W}/analytics/coaches`, studio)?.title).not.toBe("Отчёты → Тренеры")
    expect(helpEntryFor(`${W}/nope`, academy)).toBeNull()
  })
})

describe("help registry", () => {
  const entries = [
    ...Object.entries(workspace).map(([pattern, entry]) => [`workspace:${pattern}`, entry] as const),
    ...Object.entries(org).map(([pattern, entry]) => [`org:${pattern}`, entry] as const),
  ]

  it.each(entries)("%s has a title, a purpose and 1–5 actions", (_key, entry) => {
    expect(entry.title.trim()).not.toBe("")
    expect(entry.purpose.trim()).not.toBe("")
    expect(entry.actions.length).toBeGreaterThanOrEqual(1)
    expect(entry.actions.length).toBeLessThanOrEqual(5)
    for (const action of entry.actions) expect(action.trim()).not.toBe("")
  })

  it("names only known guides, each once per entry", () => {
    for (const [, entry] of entries) {
      for (const id of entry.guides ?? []) expect(GUIDE_IDS).toContain(id)
      expect(new Set(entry.guides ?? []).size).toBe((entry.guides ?? []).length)
    }
  })

  it("every guide is shown on at least one page", () => {
    const used = new Set(entries.flatMap(([, entry]) => entry.guides ?? []))
    expect([...used].sort()).toEqual([...GUIDE_IDS].sort())
  })

  it("covers every sidebar item and section tab of the club", () => {
    const paths = navGroups(academy)
      .flatMap((group) => group.items)
      .flatMap((item) => ("tabs" in item ? item.tabs.map((tab) => tab.path) : [item.path]))
    const missing = paths.filter((path) => matchHelpRoute(`${W}/${path}`, patterns)?.pattern !== path)
    expect(missing).toEqual([])
  })

  it("covers every settings section and the account-menu pages", () => {
    const paths = [
      ...settingsSections(academy, { federation: true }).map((s) =>
        s.path ? `settings/${s.path}` : "settings",
      ),
      "billing",
      "limits",
      "club-import",
    ]
    expect(paths.filter((path) => !(path in workspace))).toEqual([])
  })

  it("covers every page of the federation console", () => {
    expect(ORG_NAV.map((item) => item.path).filter((path) => !(path in org))).toEqual([])
  })
})
