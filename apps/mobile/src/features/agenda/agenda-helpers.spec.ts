import { vocabularyForWorkspaceType } from "@clubspace/ui-kit/brand"

import type { AgendaItem } from "../../shared/api/agenda"
import {
  addDaysYmd,
  agendaCacheKey,
  agendaCancelledText,
  agendaDayHeader,
  agendaKindLabel,
  agendaTimeLabel,
  groupAgendaByDay,
  itemsOn,
  resolveAgendaOpen,
  showAgendaCard,
  todayRange,
  weekRange,
} from "./agenda-helpers"

const item = (over: Partial<AgendaItem> = {}): AgendaItem => ({
  id: "class:s1:2026-11-01",
  kind: "class",
  workspaceId: "w1",
  workspaceName: "Альфа",
  title: "Взрослые",
  subtitle: null,
  startAt: "2026-11-01T16:00:00.000Z",
  endAt: "2026-11-01T17:30:00.000Z",
  timezone: "Europe/Moscow",
  date: "2026-11-01",
  cancelled: false,
  cancellationReason: null,
  myRole: "member",
  groupId: "g1",
  slotId: "s1",
  occurrenceId: "s1:2026-11-01",
  eventId: null,
  personalTrainingId: null,
  ...over,
})

describe("date ranges", () => {
  it("adds days across month and year ends", () => {
    expect(addDaysYmd("2026-10-31", 1)).toBe("2026-11-01")
    expect(addDaysYmd("2026-12-29", 6)).toBe("2027-01-04")
    expect(addDaysYmd("2026-03-01", -1)).toBe("2026-02-28")
  })

  it("uses the device's calendar day for today", () => {
    const now = new Date(2026, 10, 1, 23, 30)
    expect(todayRange(now)).toEqual({ from: "2026-11-01", to: "2026-11-01" })
  })

  it("spans seven days inclusive for the week", () => {
    expect(weekRange(new Date(2026, 10, 28, 9))).toEqual({
      from: "2026-11-28",
      to: "2026-12-04",
    })
  })

  it("keys the cache by the range, so a new day refetches", () => {
    expect(agendaCacheKey({ from: "2026-11-01", to: "2026-11-01" })).toBe(
      "agenda:2026-11-01:2026-11-01",
    )
    expect(agendaCacheKey(todayRange(new Date(2026, 10, 2)))).not.toBe(
      agendaCacheKey(todayRange(new Date(2026, 10, 1))),
    )
  })
})

describe("showAgendaCard", () => {
  it("shows only with more than one club", () => {
    expect(showAgendaCard(0)).toBe(false)
    expect(showAgendaCard(1)).toBe(false)
    expect(showAgendaCard(2)).toBe(true)
  })
})

describe("labels", () => {
  it("names every kind", () => {
    const sport = vocabularyForWorkspaceType("GRAPPLING")
    expect(agendaKindLabel("class", sport)).toBe("Тренировка")
    expect(agendaKindLabel("event", sport)).toBe("Событие")
    expect(agendaKindLabel("dropIn", sport)).toBe("Гостевое посещение")
    expect(agendaKindLabel("personalTraining", sport)).toBe("Персональная")
  })

  it("names a class in its own club's words", () => {
    const dance = vocabularyForWorkspaceType("DANCE")
    expect(agendaKindLabel("class", dance)).toBe("Занятие")
    expect(agendaKindLabel("personalTraining", dance)).toBe("Индивидуальное")
  })

  it("heads days as today, tomorrow, then the weekday", () => {
    const today = "2026-11-01"
    expect(agendaDayHeader("2026-11-01", today)).toBe("Сегодня, 1 ноября")
    expect(agendaDayHeader("2026-11-02", today)).toBe("Завтра, 2 ноября")
    expect(agendaDayHeader("2026-11-03", today)).toBe("Вторник, 3 ноября")
    expect(agendaDayHeader("2026-11-08", today)).toBe("Воскресенье, 8 ноября")
  })

  it("formats the time on the club's clock", () => {
    expect(agendaTimeLabel(item(), "Europe/Moscow")).toBe("19:00–20:30")
  })

  it("marks a club clock that differs from the phone's", () => {
    expect(agendaTimeLabel(item(), "Asia/Tomsk")).toBe("19:00–20:30 GMT+3")
  })

  it("omits a missing end", () => {
    expect(
      agendaTimeLabel(item({ endAt: item().startAt }), "Europe/Moscow"),
    ).toBe("19:00")
  })

  it("explains a cancellation", () => {
    expect(agendaCancelledText(item())).toBeNull()
    expect(agendaCancelledText(item({ cancelled: true }))).toBe("Отменено")
    expect(
      agendaCancelledText(
        item({ cancelled: true, cancellationReason: " тренер заболел " }),
      ),
    ).toBe("Отменено — тренер заболел")
  })
})

describe("groupAgendaByDay", () => {
  it("groups by the club-local date and sorts days and items", () => {
    const late = item({ id: "a", startAt: "2026-11-01T18:00:00.000Z" })
    const early = item({ id: "b", startAt: "2026-11-01T06:00:00.000Z" })
    // 23:30 UTC on Nov 1 is already Nov 2 in Tomsk: the item's own date wins.
    const tomsk = item({
      id: "c",
      startAt: "2026-11-01T23:30:00.000Z",
      timezone: "Asia/Tomsk",
      date: "2026-11-02",
    })
    const days = groupAgendaByDay([tomsk, late, early])
    expect(days.map((d) => d.date)).toEqual(["2026-11-01", "2026-11-02"])
    expect(days[0].items.map((i) => i.id)).toEqual(["b", "a"])
    expect(days[1].items.map((i) => i.id)).toEqual(["c"])
  })

  it("is empty for no items", () => {
    expect(groupAgendaByDay([])).toEqual([])
  })

  it("picks one day's items", () => {
    const other = item({ id: "x", date: "2026-11-03" })
    expect(itemsOn([item(), other], "2026-11-03").map((i) => i.id)).toEqual([
      "x",
    ])
    expect(itemsOn([item()], "2026-11-05")).toEqual([])
  })
})

describe("resolveAgendaOpen", () => {
  const known = ["w1", "w2"]

  it("opens the schedule for classes and guest visits", () => {
    expect(resolveAgendaOpen(item(), "w1", known)).toEqual({
      switchTo: null,
      target: { screen: "Schedule" },
    })
    expect(
      resolveAgendaOpen(item({ kind: "dropIn" }), "w1", known)?.target,
    ).toEqual({ screen: "Schedule" })
  })

  it("switches to another club first", () => {
    expect(
      resolveAgendaOpen(item({ workspaceId: "w2" }), "w1", known)?.switchTo,
    ).toBe("w2")
  })

  it("opens events and personal sessions", () => {
    expect(
      resolveAgendaOpen(item({ kind: "event", eventId: "e1" }), "w1", known)
        ?.target,
    ).toEqual({ screen: "Events" })
    expect(
      resolveAgendaOpen(
        item({ kind: "personalTraining", personalTrainingId: "pt1" }),
        "w1",
        known,
      )?.target,
    ).toEqual({ screen: "PersonalTraining", requestId: "pt1" })
    expect(
      resolveAgendaOpen(item({ kind: "personalTraining" }), "w1", known)
        ?.target,
    ).toEqual({ screen: "PersonalTrainings" })
  })

  it("does nothing for a club the member has left", () => {
    expect(
      resolveAgendaOpen(item({ workspaceId: "gone" }), "w1", known),
    ).toBeNull()
  })
})
