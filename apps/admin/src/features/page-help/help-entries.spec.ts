import { vocabularyForWorkspaceType } from "@clubspace/ui-kit/brand"

import { ORG_NAV } from "../../app/(dashboard)/org/[orgId]/org-sidebar"
import { navGroups } from "../../app/(dashboard)/workspace/[workspaceId]/workspace-sidebar"
import { hasAccess, type CurrentMembership } from "../../shared/lib/permissions"
import { settingsSections } from "../settings/SettingsNav"
import {
  GUIDE_IDS,
  helpEntryFor,
  matchHelpRoute,
  orgHelp,
  visibleActions,
  workspaceHelp,
  type HelpAccess,
  type HelpAction,
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

  const textOf = (action: HelpAction) => (typeof action === "string" ? action : action.text)

  it.each(entries)("%s has a title, a purpose and 1–5 actions", (_key, entry) => {
    expect(entry.title.trim()).not.toBe("")
    expect(entry.purpose.trim()).not.toBe("")
    expect(entry.actions.length).toBeGreaterThanOrEqual(1)
    expect(entry.actions.length).toBeLessThanOrEqual(5)
    for (const action of entry.actions) expect(textOf(action).trim()).not.toBe("")
    expect(new Set(entry.actions.map(textOf)).size).toBe(entry.actions.length)
  })

  it("tags club pages with club access and federation pages with orgAdmin only", () => {
    const tags = (registry: typeof workspace) =>
      Object.values(registry).flatMap((entry) =>
        entry.actions.flatMap((action) => (typeof action === "string" ? [] : [action.access])),
      )
    expect(tags(workspace)).not.toContain("orgAdmin")
    expect(new Set(tags(org))).toEqual(new Set(["orgAdmin"]))
  })

  it("leaves every club page at least one line for everyone who can open it", () => {
    const empty = Object.entries(workspace)
      .filter(([, entry]) => visibleActions(entry, () => false).length === 0)
      .map(([pattern]) => pattern)
    expect(empty).toEqual([])
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
      // Linked from JSX only (the sidebar's account menu and the «Ученики»
      // «Ещё» menu), so not derivable: keep in step with those links.
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

describe("visibleActions", () => {
  const m = (role: string, isOwner = false, managedDirectionIds: string[] = []): CurrentMembership => ({
    role,
    isOwner,
    managedDirectionIds,
  })
  const club = (membership: CurrentMembership | null) => (access: HelpAccess) =>
    access !== "orgAdmin" && hasAccess(membership, access)
  const card = workspace["users/*"]
  const ALL = [
    "«Новый абонемент» — тариф, скидка, сумма; дальше «Отметить оплату», «Продлить», «Заморозить»",
    "«Выдать ранг» — лестница, уровень и полоски",
    "«Профиль» → «Изменить» — имя, телефон, дата рождения",
    "«Написать сообщение» в меню действий",
    "В меню действий — «Изменить доступ к приложению», «Карта для входа», «Удалить из клуба»",
  ]

  it("shows the owner and a club admin every line", () => {
    expect(visibleActions(card, club(m("user", true)))).toEqual(ALL)
    expect(visibleActions(card, club(m("admin")))).toEqual(ALL)
  })

  it("hides the lines a role never gets", () => {
    expect(visibleActions(card, club(m("coach")))).toEqual([ALL[0], ALL[3]])
    // A direction manager promotes in their directions, edits no profiles.
    expect(visibleActions(card, club(m("coach", false, ["d1"])))).toEqual([ALL[0], ALL[1], ALL[3]])
    expect(visibleActions(card, club(m("head_coach")))).toEqual(ALL)
    // Membership still loading: only the lines everyone has.
    expect(visibleActions(card, club(null))).toEqual([ALL[0], ALL[3]])
  })

  it("keeps the club launch and money lines of «Сегодня» for club admins", () => {
    const today = workspace[""]
    expect(visibleActions(today, club(m("head_coach")))).toHaveLength(2)
    expect(visibleActions(today, club(m("admin")))).toHaveLength(4)
    expect(visibleActions(workspace.users, club(m("coach"))).join()).not.toContain("Импорт")
  })

  it("shows federation admins' controls to admins only", () => {
    const admin = (access: HelpAccess) => access === "orgAdmin"
    const coach = () => false
    expect(visibleActions(org.announcements, coach)).toEqual([])
    expect(visibleActions(org.announcements, admin)).toHaveLength(3)
    expect(visibleActions(org[""], coach)).toEqual(["Нажать на клуб — что он показывает федерации"])
  })
})
