import { vocabularyForWorkspaceType } from "@clubspace/ui-kit/brand"

import type { OpenRequest, RequestCounts } from "../../shared/api/requests"
import {
  detailLine,
  emptyInboxText,
  formatClipTime,
  formatSlot,
  guardiansLine,
  inboxSearch,
  kindFilterLabel,
  kindLabel,
  optionLabel,
  parseInboxSearch,
  requestsBreakdown,
  requestsHref,
  waitingLabel,
} from "./request-view"

const sport = vocabularyForWorkspaceType("GRAPPLING")
const dance = vocabularyForWorkspaceType("DANCE")

const member = (over: Partial<OpenRequest["member"]> = {}): OpenRequest["member"] => ({
  userId: "u1",
  name: "Анна Петрова",
  email: "anna@example.com",
  isDependent: false,
  guardians: [],
  ...over,
})

const base = (over: Partial<OpenRequest>): OpenRequest => ({
  id: "join:m1",
  kind: "join",
  requestId: "u1",
  createdAt: "2026-11-15T09:00:00.000Z",
  member: member(),
  join: null,
  freeze: null,
  personal: null,
  video: null,
  ...over,
})

const join = (roleName = "user", over: Partial<OpenRequest["member"]> = {}) =>
  base({ join: { roleName }, member: member(over) })

const freeze = base({
  id: "freeze:f1",
  kind: "freeze",
  requestId: "f1",
  freeze: {
    fromDate: "2026-11-18",
    untilDate: "2026-11-27",
    days: 10,
    reason: "Отпуск",
    planName: "Взрослые 12",
    subscriptionId: "s1",
    subscriptionEndDate: "2026-12-31T00:00:00.000Z",
  },
})

const personal = (options: number, coachId = "c1") =>
  base({
    id: "personal:p1",
    kind: "personal",
    requestId: "p1",
    personal: {
      coach: { userId: coachId, name: "Олег Смирнов" },
      gymName: null,
      timezone: "Asia/Tomsk",
      memberComment: null,
      options: Array.from({ length: options }, (_, i) => ({
        id: `o${i}`,
        // 06:00Z is 13:00 in Tomsk (UTC+7).
        startAt: `2026-11-2${1 + i}T06:00:00.000Z`,
        durationMin: 60,
      })),
    },
  })

const video = (clipStatus: "processing" | "ready") =>
  base({
    id: "video:v1",
    kind: "video",
    requestId: "v1",
    video: { title: "Спарринг", message: null, clipStatus, durationSec: 90, commentCount: 0 },
  })

const counts = (over: Partial<RequestCounts>): RequestCounts => {
  const c = { join: 0, freeze: 0, personal: 0, video: 0, ...over }
  return { ...c, total: c.join + c.freeze + c.personal + c.video }
}

describe("request kinds", () => {
  it("names the personal kind in the club's words", () => {
    expect(kindLabel("personal", sport)).toBe("Персональная тренировка")
    expect(kindLabel("personal", dance)).toBe("Индивидуальное занятие")
    expect(kindFilterLabel("personal", dance)).toBe("Индивидуальные занятия")
    expect(kindLabel("video", sport)).toBe("Разбор видео")
    expect(kindFilterLabel("video", sport)).toBe("Разборы видео")
  })
})

describe("row detail line", () => {
  it("join: the e-mail, the staff role, nothing for a child (the badge says it)", () => {
    expect(detailLine(join(), sport, null)).toBe("anna@example.com")
    expect(detailLine(join("coach"), sport, null)).toBe("anna@example.com · роль: Тренер")
    expect(detailLine(join("coach"), dance, null)).toBe("anna@example.com · роль: Педагог")
    expect(detailLine(join("user", { email: null, isDependent: true }), sport, null)).toBe("")
  })

  it("freeze: days from the day, the tariff, the reason", () => {
    expect(detailLine(freeze, sport, null)).toBe("10 дней с 18 нояб. · Взрослые 12 · Отпуск")
  })

  it("personal: the first time in the request's zone, the rest counted, the coach for others", () => {
    expect(detailLine(personal(1), sport, "c1")).toBe("сб, 21 нояб., 13:00")
    expect(detailLine(personal(2), sport, "c1")).toBe("сб, 21 нояб., 13:00 · ещё 1 вариант")
    expect(detailLine(personal(3), sport, "admin")).toBe(
      "сб, 21 нояб., 13:00 · ещё 2 варианта · Олег Смирнов",
    )
  })

  it("video: the title, and while processing says so", () => {
    expect(detailLine(video("ready"), sport, null)).toBe("«Спарринг»")
    expect(detailLine(video("processing"), sport, null)).toBe("«Спарринг» · видео обрабатывается")
  })

  it("lists a child's guardians as the roster does", () => {
    expect(
      guardiansLine(
        member({
          guardians: [
            {
              userId: "g1",
              firstname: "Ирина",
              lastname: "Петрова",
              email: null,
              phone: null,
              relation: "PARENT",
              confirmed: true,
            },
          ],
        }),
      ),
    ).toBe("Родитель: Ирина Петрова")
    expect(guardiansLine(member())).toBeNull()
  })
})

describe("waiting time", () => {
  const now = new Date("2026-11-15T12:00:00.000Z")
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()

  it("minutes, hours, days, then the date after a week", () => {
    expect(waitingLabel(ago(20_000), now)).toBe("только что")
    expect(waitingLabel(ago(25 * 60_000), now)).toBe("25 мин")
    expect(waitingLabel(ago(2 * 3_600_000), now)).toBe("2 ч")
    expect(waitingLabel(ago(3 * 86_400_000), now)).toBe("3 дня")
    expect(waitingLabel(ago(5 * 86_400_000), now)).toBe("5 дней")
    expect(waitingLabel(ago(12 * 86_400_000), now)).toBe("3 нояб.")
    expect(waitingLabel("2025-11-03T12:00:00.000Z", now)).toMatch(/^3 нояб\. 2025/)
  })
})

describe("personal times", () => {
  it("are shown in the request's time zone, not the browser's", () => {
    expect(formatSlot("2026-11-21T06:00:00.000Z", "Asia/Tomsk")).toBe("сб, 21 нояб., 13:00")
    expect(formatSlot("2026-11-21T06:00:00.000Z", "Europe/Moscow")).toBe("сб, 21 нояб., 09:00")
    expect(
      optionLabel({ id: "o1", startAt: "2026-11-21T06:00:00.000Z", durationMin: 90 }, "Asia/Tomsk"),
    ).toBe("сб, 21 нояб., 13:00 · 90 мин")
  })
})

describe("«Сегодня» row", () => {
  it("breaks the count down by the kinds that wait, in the club's words", () => {
    expect(requestsBreakdown(counts({ join: 2, freeze: 1, personal: 1, video: 1 }), sport)).toBe(
      "2 на вступление · 1 на заморозку · 1 на персональную тренировку · 1 на разбор видео",
    )
    expect(requestsBreakdown(counts({ personal: 3 }), dance)).toBe("3 на индивидуальное занятие")
    expect(requestsBreakdown(counts({}), sport)).toBe("")
  })

  it("links to the list, filtered when only one kind waits", () => {
    expect(requestsHref("w1", counts({ freeze: 2 }))).toBe("/workspace/w1/users/requests?kind=freeze")
    expect(requestsHref("w1", counts({ freeze: 2, video: 1 }))).toBe("/workspace/w1/users/requests")
  })
})

describe("inbox URL state", () => {
  it("reads and writes ?kind= and ?request=, ignoring an unknown kind", () => {
    expect(parseInboxSearch("?kind=freeze&request=freeze%3Af1")).toEqual({
      kind: "freeze",
      request: "freeze:f1",
    })
    expect(parseInboxSearch("?kind=bogus")).toEqual({ kind: null, request: null })
    expect(inboxSearch({ kind: "video", request: "video:v1" })).toBe("?kind=video&request=video%3Av1")
    expect(inboxSearch({ kind: null, request: null })).toBe("")
  })

  it("says which empty it is", () => {
    expect(emptyInboxText(null)).toBe("Новых заявок нет")
    expect(emptyInboxText("join")).toBe("Заявок этого вида нет")
  })

  it("formats a clip moment", () => {
    expect(formatClipTime(42)).toBe("0:42")
    expect(formatClipTime(725.9)).toBe("12:05")
  })
})
