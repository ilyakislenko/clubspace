import { vocabularyForWorkspaceType } from "@clubspace/ui-kit/brand"

import { templateUpdateNote } from "./FederationTemplates"
import {
  audienceLabel,
  NOT_SHARED,
  adoptedText,
  beltText,
  bookedByLabel,
  bookedText,
  clubsCount,
  confirmedByText,
  eventWhen,
  formatCount,
  formatDate,
  formatMoney,
  formatRate,
  groupByClub,
  isOrgAdminRole,
  moneyCoverage,
  monthKey,
  monthTitle,
  orgRoleLabel,
  toCsv,
  wallClockInput,
} from "./org-view"

const BJJ = vocabularyForWorkspaceType("GRAPPLING")
const DANCE = vocabularyForWorkspaceType("DANCE")

describe("org roles", () => {
  it("only ORG_ADMIN administers; unknown roles get a neutral word", () => {
    expect(isOrgAdminRole("ORG_ADMIN")).toBe(true)
    expect(isOrgAdminRole("ORG_COACH")).toBe(false)
    expect(isOrgAdminRole(null)).toBe(false)
    expect(orgRoleLabel("ORG_COACH", BJJ)).toBe("Тренер федерации")
    expect(orgRoleLabel("ORG_COACH", DANCE)).toBe("Педагог федерации")
    expect(orgRoleLabel("ORG_ADMIN", DANCE)).toBe("Администратор федерации")
    expect(orgRoleLabel("SOMETHING", BJJ)).toBe("Команда федерации")
  })

  it("names the audience in the federation's words", () => {
    expect(audienceLabel("STAFF", BJJ)).toBe("Тренерам клубов")
    expect(audienceLabel("STAFF_AND_MEMBERS", DANCE)).toBe("Педагогам и ученикам")
  })
})

describe("numbers", () => {
  it("formats counts and retention, never NaN", () => {
    expect(formatCount(1234)).toMatch(/^1\s234$/)
    expect(formatCount(null)).toBe("—")
    expect(formatRate(0.624)).toBe("62%")
    expect(formatRate(null)).toBe("—")
  })

  it("shows money only when the club opened it", () => {
    expect(formatMoney(null)).toBe(NOT_SHARED)
    expect(formatMoney({ amount: 125000, currency: "RUB" })).toMatch(/125\s000 ₽/)
    expect(formatMoney({ amount: 0, currency: null })).toMatch(/^0 ₽$/)
  })

  it("says how many clubs a money total covers", () => {
    expect(moneyCoverage(1, 2)).toBe("по 1 из 2 клубов")
    expect(moneyCoverage(1, 21)).toBe("по 1 из 21 клуба")
    expect(moneyCoverage(3, 5)).toBe("по 3 из 5 клубов")
    expect(clubsCount(2)).toBe("2 клуба")
    expect(clubsCount(5)).toBe("5 клубов")
  })
})

describe("registry rows", () => {
  it("names the belt with its stripes and the confirming club", () => {
    expect(beltText({ levelName: "Синий пояс", stripes: 2 })).toBe("Синий пояс · 2 полоски")
    expect(beltText({ levelName: "Белый пояс", stripes: 0 })).toBe("Белый пояс")
    expect(beltText({ levelName: "Синий пояс", stripes: 1 })).toBe("Синий пояс · 1 полоска")
    expect(confirmedByText("ACADEMY")).toBe("подтверждён клубом ACADEMY")
  })

  it("reads a calendar date without shifting it", () => {
    expect(formatDate("2026-03-12")).toBe("12 марта 2026 г.")
    expect(formatDate("2026-03-12T23:30:00.000Z")).toBe("12 марта 2026 г.")
  })
})

describe("calendar", () => {
  it("labels who registered and how full the event is", () => {
    expect(bookedByLabel("COACH", BJJ)).toBe("записал тренер")
    expect(bookedByLabel("SELF", BJJ)).toBe("сам")
    expect(bookedText(23, 200)).toBe("Записано 23 из 200")
    expect(bookedText(4, null)).toBe("Записано 4")
  })

  it("groups registrations by club, clubs by name", () => {
    const groups = groupByClub([
      { clubName: "Беркут", id: "1" },
      { clubName: "ACADEMY", id: "2" },
      { clubName: "Беркут", id: "3" },
    ])
    // Russian collation: Cyrillic names before Latin ones.
    expect(groups.map((g) => [g.clubName, g.rows.map((r) => r.id)])).toEqual([
      ["Беркут", ["1", "3"]],
      ["ACADEMY", ["2"]],
    ])
  })

  it("builds a semicolon CSV with a BOM and quotes what needs it", () => {
    expect(toCsv(["Клуб", "Имя"], [["ACADEMY", 'Иван "Ваня"; Петров']])).toBe(
      '\uFEFFКлуб;Имя\r\nACADEMY;"Иван ""Ваня""; Петров"\r\n',
    )
  })

  it("groups by month and writes times in the event's zone", () => {
    // 31 Dec 20:00 UTC is already January in Tomsk (UTC+7).
    expect(monthKey("2026-12-31T20:00:00.000Z", "Asia/Tomsk")).toBe("2027-01")
    expect(monthKey("2026-12-31T20:00:00.000Z", "Europe/Moscow")).toBe("2026-12")
    expect(monthTitle("2026-12")).toBe("Декабрь 2026")
    expect(eventWhen("2026-12-14T03:00:00.000Z", "2026-12-14T11:00:00.000Z", "Asia/Tomsk")).toBe(
      "14 дек., 10:00 – 18:00",
    )
    expect(eventWhen("2026-12-14T03:00:00.000Z", null, "Asia/Tomsk")).toBe("14 дек., 10:00")
    expect(wallClockInput("2026-12-14T03:00:00.000Z", "Asia/Tomsk")).toBe("2026-12-14T10:00")
    expect(wallClockInput("2026-12-13T17:00:00.000Z", "Asia/Tomsk")).toBe("2026-12-14T00:00")
  })
})

describe("standards", () => {
  it("lists the clubs that adopted a standard, with their versions", () => {
    expect(
      adoptedText([
        { clubName: "ACADEMY", version: 2 },
        { clubName: "Беркут", version: 1 },
      ]),
    ).toBe("Принят в клубах: ACADEMY (v2), Беркут (v1)")
    expect(adoptedText([])).toBeNull()
  })

  it("notes a club copy older than its standard", () => {
    const templates = [{ id: "t1", version: 2 }]
    expect(templateUpdateNote({ templateId: "t1", templateVersion: 1 }, templates)).toBe(
      "Стандарт федерации обновлён до версии 2",
    )
    expect(templateUpdateNote({ templateId: "t1", templateVersion: 2 }, templates)).toBeNull()
    expect(templateUpdateNote({ templateId: null, templateVersion: null }, templates)).toBeNull()
    expect(templateUpdateNote({ templateId: "gone", templateVersion: 1 }, templates)).toBeNull()
  })
})
