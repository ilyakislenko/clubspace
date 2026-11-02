import { vocabularyForWorkspaceType } from "@clubspace/ui-kit/brand"

import {
  ACTION_CATEGORIES,
  ACTION_CATEGORY_LABELS,
  actionMetaFor,
  formatActor,
  parseMetadata,
  targetTypeLabel,
} from "./audit-meta"

const GRAPPLING = vocabularyForWorkspaceType("GRAPPLING")
const DANCE = vocabularyForWorkspaceType("DANCE")

describe("formatActor", () => {
  it("prefers the display label, then the email", () => {
    expect(
      formatActor({ actorLabel: "Иван Петров", actorEmail: "i@x.ru" }),
    ).toBe("Иван Петров")
    expect(formatActor({ actorLabel: null, actorEmail: "i@x.ru" })).toBe(
      "i@x.ru",
    )
  })

  it("never leaks a raw id", () => {
    expect(formatActor({ actorId: "3f2a9c1e-1111" })).toBe(
      "Неизвестный пользователь",
    )
  })

  it("falls back to the system placeholder without an actor", () => {
    expect(formatActor({ actorLabel: null, actorEmail: null })).toBe("Система")
  })
})

describe("targetTypeLabel", () => {
  it("maps known target types and falls back to the raw value", () => {
    expect(targetTypeLabel("member")).toBe("Участник")
    expect(targetTypeLabel("mystery")).toBe("mystery")
  })
})

describe("actionMetaFor", () => {
  it.each([
    ["auth.signIn", "Вход в аккаунт"],
    ["auth.lockout", "Вход заблокирован после неверных кодов"],
    ["me.export", "Выгрузка своих данных"],
    ["export.members", "Выгрузка CSV: участники"],
    ["export.renewals", "Выгрузка CSV: продления"],
    ["export.attendance", "Выгрузка CSV: посещаемость"],
    ["export.revenue", "Выгрузка CSV: выручка"],
    ["group.occurrenceMove", "Занятие перенесено"],
    ["group.slotSplit", "Расписание изменено с даты"],
    ["platform.accessClub", "Платформа открыла клуб"],
    ["workspace.create", "Клуб создан"],
    ["workspace.legalAccept", "Принята оферта"],
  ])("labels %s", (action, label) => {
    expect(actionMetaFor(GRAPPLING)[action]?.label).toBe(label)
  })

  it.each([
    ["group.exceptionCreate", "Отмена тренировки добавлена", "Отмена занятия добавлена"],
    ["group.substituteAssign", "Назначена замена тренера", "Назначена замена педагога"],
    [
      "group.substituteRequest",
      "Тренер попросил провести занятие",
      "Педагог попросил провести занятие",
    ],
  ])("names %s in the club's words", (action, grappling, dance) => {
    expect(actionMetaFor(GRAPPLING)[action]?.label).toBe(grappling)
    expect(actionMetaFor(DANCE)[action]?.label).toBe(dance)
  })
})

describe("ACTION_CATEGORIES", () => {
  it("offers club-scoped families, each with a human label", () => {
    expect(ACTION_CATEGORIES).toEqual(
      expect.arrayContaining(["export", "platform", "member"]),
    )
    for (const category of ACTION_CATEGORIES) {
      expect(ACTION_CATEGORY_LABELS[category]).toBeDefined()
    }
  })

  it("leaves out account-level families the club journal never contains", () => {
    expect(ACTION_CATEGORIES).not.toContain("auth")
    expect(ACTION_CATEGORIES).not.toContain("me")
  })
})

describe("parseMetadata", () => {
  it("labels the platform access request", () => {
    expect(
      parseMetadata(
        { method: "GET", route: "/workspaces/:workspaceId/members" },
        GRAPPLING,
      ),
    ).toEqual([
      { key: "method", label: "Метод", value: "GET" },
      {
        key: "route",
        label: "Маршрут",
        value: "/workspaces/:workspaceId/members",
      },
    ])
  })

  it("names the coach field in the club's words", () => {
    expect(parseMetadata({ coachId: "x" }, GRAPPLING)[0].label).toBe("Тренер")
    expect(parseMetadata({ coachId: "x" }, DANCE)[0].label).toBe("Педагог")
  })
})
