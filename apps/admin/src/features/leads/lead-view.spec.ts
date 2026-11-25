import type { Lead } from "../../shared/api/leads"
import { leadFixture } from "./lead-fixtures"
import {
  childLine,
  consentLine,
  duplicateLeadId,
  leadActions,
  metaLine,
  parsePipelineSearch,
  pipelineSearch,
  splitName,
  statusLine,
  timeline,
  todayHint,
  wallClockIn,
} from "./lead-view"

const NOW = new Date("2026-11-26T12:00:00.000Z")
const TZ = "Europe/Moscow"

describe("row lines", () => {
  it("names a child request and the meta line shows only what is known", () => {
    expect(childLine(leadFixture())).toBeNull()
    expect(childLine(leadFixture({ forChild: true, childName: "Маша", childAge: 8 }))).toBe(
      "для ребёнка: Маша, 8 лет",
    )
    expect(childLine(leadFixture({ forChild: true, childName: "Петя", childAge: 3 }))).toBe(
      "для ребёнка: Петя, 3 года",
    )
    expect(metaLine(leadFixture({ directionName: "Дети", source: "QR" }))).toBe(
      "+7 952 884-94-20 · Дети · QR-плакат",
    )
    expect(metaLine(leadFixture({ phone: null, source: "MANUAL" }))).toBe("Вручную")
  })

  it("says where the lead stands", () => {
    expect(statusLine(leadFixture(), NOW)).toBe("новая · 2 ч")
    expect(statusLine(leadFixture({ status: "CONTACTED", contactedAt: "2026-11-23T12:00:00.000Z" }), NOW)).toBe(
      "связались 3 дня назад",
    )
    // Saturday 28 Nov 18:00 in the zone the trial was booked in (a Novosibirsk
    // gym of a Moscow club reads its own local time).
    const booked = { status: "TRIAL_BOOKED", trialAt: "2026-11-28T15:00:00.000Z" } as const
    expect(statusLine(leadFixture(booked), NOW)).toBe("пробное сб 18:00")
    expect(statusLine(leadFixture({ ...booked, trialTimezone: "Asia/Novosibirsk" }), NOW)).toBe("пробное сб 22:00")
    expect(statusLine(leadFixture({ status: "TRIAL_BOOKED", trialAt: "2026-11-25T15:00:00.000Z" }), NOW)).toBe(
      "пробное прошло — отметьте",
    )
    expect(statusLine(leadFixture({ status: "CAME", cameAt: "2026-11-23T12:00:00.000Z" }), NOW)).toBe(
      "пришёл 3 дня назад",
    )
    expect(statusLine(leadFixture({ status: "CAME", displayStatus: "BOUGHT" }), NOW)).toBe("купил абонемент")
    expect(statusLine(leadFixture({ status: "LOST", lostReason: "PRICE" }), NOW)).toBe("отказ: цена")
  })
})

describe("«Сегодня» hint", () => {
  it("lists only the non-zero parts", () => {
    expect(todayHint({ new: 2, trialOverdue: 1 })).toBe("2 новых · 1 ждёт отметки после пробного")
    expect(todayHint({ new: 1, trialOverdue: 0 })).toBe("1 новая")
    expect(todayHint({ new: 0, trialOverdue: 3 })).toBe("3 ждут отметки после пробного")
  })
})

describe("panel actions", () => {
  it("has one filled next step per state and at most one outline", () => {
    const of = (over: Partial<Lead>) => leadActions(leadFixture(over))
    expect(of({ status: "NEW" })).toEqual({ primary: "contacted", secondary: "book" })
    expect(of({ status: "CONTACTED" })).toEqual({ primary: "book", secondary: null })
    expect(of({ status: "TRIAL_BOOKED" })).toEqual({ primary: "came", secondary: "rebook" })
    expect(of({ status: "CAME" })).toEqual({ primary: "addToClub", secondary: "link" })
    expect(of({ status: "CAME", convertedUserId: "u1" })).toEqual({ primary: "openMember", secondary: null })
    expect(of({ status: "LOST" })).toEqual({ primary: "reopen", secondary: null })
    expect(of({ status: "LOST", anonymizedAt: NOW.toISOString() })).toEqual({ primary: null, secondary: null })
  })
})

describe("timeline and consent", () => {
  it("lists the dated steps oldest first and closes with the derived purchase", () => {
    const lead = leadFixture({
      status: "CAME",
      displayStatus: "BOUGHT",
      contactedAt: "2026-11-26T10:30:00.000Z",
      cameAt: "2026-11-26T11:30:00.000Z",
      convertedAt: "2026-11-26T11:40:00.000Z",
    })
    expect(timeline(lead, NOW).map((s) => s.label)).toEqual([
      "Заявка получена",
      "Связались",
      "Пришёл на пробное",
      "Добавлен в клуб",
      "Купил абонемент",
    ])
  })

  it("names the form's edition, or the staff member for a manual request", () => {
    expect(consentLine(leadFixture(), NOW)).toContain("редакция 2026-12-01")
    expect(consentLine(leadFixture({ source: "MANUAL", consentRecordedByName: "Ольга К." }), NOW)).toBe(
      "Согласие подтвердил(а) Ольга К.",
    )
  })
})

describe("URL state", () => {
  it("round-trips and drops the defaults", () => {
    const s = parsePipelineSearch("?view=lost&source=QR&q=%2B7952&lead=l1")
    expect(s).toEqual({ view: "lost", source: "QR", q: "+7952", lead: "l1" })
    expect(pipelineSearch(s)).toBe("?view=lost&source=QR&q=%2B7952&lead=l1")
    expect(pipelineSearch(parsePipelineSearch("?view=bogus&source=x"))).toBe("")
  })
})

describe("helpers", () => {
  it("splits a name, reads the club's wall clock and the duplicate's id", () => {
    expect(splitName(" Анна  Петрова-Смирнова ")).toEqual({ firstname: "Анна", lastname: "Петрова-Смирнова" })
    expect(splitName("Анна")).toEqual({ firstname: "Анна", lastname: "" })
    expect(wallClockIn("2026-11-28T15:00:00.000Z", TZ)).toEqual(["2026-11-28", "18:00"])
    const dup = { response: { status: 409, data: { code: "LEAD_DUPLICATE", metadata: { leadId: "l9" } } } }
    expect(duplicateLeadId(dup)).toBe("l9")
    expect(duplicateLeadId({ response: { status: 400, data: {} } })).toBeNull()
  })
})
