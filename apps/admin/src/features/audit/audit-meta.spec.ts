import { vocabularyForWorkspaceType } from "@clubspace/ui-kit/brand"

import {
  ACTION_CATEGORIES,
  ACTION_CATEGORY_LABELS,
  actionMetaFor,
  formatActor,
  parseMetadata,
  targetTypeLabel,
  unknownActionMeta,
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
  it("maps known target types and never shows a raw one", () => {
    expect(targetTypeLabel("member")).toBe("Участник")
    expect(targetTypeLabel("mystery")).toBe("Объект")
  })
})

describe("unknownActionMeta", () => {
  it("names an unlabelled action by its area, never by the slug", () => {
    expect(unknownActionMeta("group.somethingNew").label).toBe("Изменение в разделе «Группы»")
    expect(unknownActionMeta("mystery.thing").label).toBe("Изменение в клубе")
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
    ["export.payments", "Выгрузка CSV: платежи"],
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
      "Тренер попросил провести тренировку",
      "Педагог попросил провести занятие",
    ],
    ["group.occurrenceMove", "Тренировка перенесена", "Занятие перенесено"],
    ["booking.staffRemove", "Ученик снят с тренировки", "Ученик снят с занятия"],
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
  it("shows the platform request as the club area, without HTTP plumbing", () => {
    expect(
      parseMetadata(
        { method: "GET", route: "/workspaces/:workspaceId/members" },
        GRAPPLING,
      ),
    ).toEqual([{ key: "route", label: "Раздел", value: "Ученики" }])
  })

  it("labels the course address instead of «slug»", () => {
    expect(parseMetadata({ title: "Kimura", slug: "kimura" }, GRAPPLING)).toEqual([
      { key: "title", label: "Название", value: "Kimura" },
      { key: "slug", label: "Адрес страницы", value: "kimura" },
    ])
  })

  it("shows the names the server resolved and never a raw id", () => {
    const id = "d3071fb0-1111-4222-8333-444455556666"
    expect(parseMetadata({ addedVideos: [id, id] }, GRAPPLING)).toEqual([
      { key: "addedVideos", label: "Добавлено видео", value: "2" },
    ])
    expect(
      parseMetadata({ movedVideo: id, afterId: id, beforeId: null, chapterId: id }, GRAPPLING),
    ).toEqual([{ key: "movedVideo", label: "Видео перемещено", value: "" }])
    expect(parseMetadata({ slotId: id, userId: id, exceptionId: id }, GRAPPLING)).toEqual([])

    expect(
      parseMetadata(
        {
          userId: "Иван Петров (ivan@x.ru)",
          slotId: "Пн 19:00 (90 мин)",
          gymId: "Север",
          movedVideo: "Kimura from guard",
          chapterId: "Основы",
        },
        GRAPPLING,
      ),
    ).toEqual([
      { key: "userId", label: "Участник", value: "Иван Петров (ivan@x.ru)" },
      { key: "slotId", label: "Время в расписании", value: "Пн 19:00 (90 мин)" },
      { key: "gymId", label: "Зал", value: "Север" },
      { key: "movedVideo", label: "Перемещено видео", value: "Kimura from guard" },
      { key: "chapterId", label: "Глава", value: "Основы" },
    ])
  })

  it("names the coach in the club's words and translates resolved roles once", () => {
    expect(parseMetadata({ coachId: "Анна Ли" }, GRAPPLING)[0].label).toBe("Тренер")
    expect(parseMetadata({ coachId: "Анна Ли" }, DANCE)[0].label).toBe("Педагог")
    expect(
      parseMetadata({ fromRoleId: "coach", toRoleId: "admin", toRoleName: "admin" }, GRAPPLING),
    ).toEqual([
      { key: "fromRoleId", label: "Роль до", value: "Тренер" },
      { key: "toRoleName", label: "Роль после", value: "Администратор" },
    ])
    expect(
      parseMetadata({ added: { userId: "Анна Ли", role: "assistant" } }, GRAPPLING)[0].value,
    ).toBe("Анна Ли — помощник тренера")
  })

  it("translates edited field names, the coach in the club's words", () => {
    expect(parseMetadata({ fields: ["title"] }, GRAPPLING)).toEqual([
      { key: "fields", label: "Изменено", value: "название" },
    ])
    expect(parseMetadata({ fields: ["coachId", "startAt"] }, GRAPPLING)[0].value).toBe(
      "тренер, начало",
    )
    expect(parseMetadata({ fields: ["coachId", "startAt"] }, DANCE)[0].value).toBe(
      "педагог, начало",
    )
    expect(parseMetadata({ fields: ["thumbnailUrl", "somethingNew"] }, GRAPPLING)[0].value).toBe(
      "обложка и ещё 1",
    )
  })

  it("spells out settings changes and drops an empty one", () => {
    expect(
      parseMetadata({ changes: { ranksEnabled: false, timezone: "Europe/Moscow" } }, GRAPPLING),
    ).toEqual([
      {
        key: "changes",
        label: "Изменения",
        value: "раздел «Пояса»: выкл.; часовой пояс: Europe/Moscow",
      },
    ])
    expect(parseMetadata({ changes: {} }, GRAPPLING)).toEqual([])
  })

  it("translates enum values and hides unknown keys and values", () => {
    expect(
      parseMetadata(
        { tool: "at_risk_members", dataMode: "PSEUDONYMIZED", toRoleName: "head_coach", weird: "x" },
        GRAPPLING,
      ),
    ).toEqual([
      { key: "tool", label: "Инструмент", value: "Кто может уйти" },
      { key: "dataMode", label: "Режим данных", value: "Обезличено" },
      { key: "toRoleName", label: "Роль после", value: "Главный тренер" },
    ])
    expect(parseMetadata({ tool: "brand_new_tool" }, GRAPPLING)).toEqual([])
  })

  it("spells out a payments export's filters", () => {
    expect(
      parseMetadata(
        {
          from: "2026-11-01",
          to: "2026-11-15",
          method: "CASH",
          q: "Иван",
          markedById: "7b0c2f4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
        },
        GRAPPLING,
      ),
    ).toEqual([
      { key: "from", label: "С", value: "01.11.2026" },
      { key: "to", label: "По", value: "15.11.2026" },
      { key: "method", label: "Способ оплаты", value: "наличные" },
      { key: "q", label: "Поиск", value: "Иван" },
    ])
  })

  it("formats dates", () => {
    expect(parseMetadata({ fromDate: "2026-11-16" }, GRAPPLING)[0].value).toBe("16.11.2026")
  })
})
