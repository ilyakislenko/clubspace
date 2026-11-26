import type { MyClubOrganization } from "../../shared/api/organizations"
import {
  canRegisterStudents,
  consentPrivacyLine,
  consentSwitchLabel,
  federationLabel,
  filterStudentsByName,
  orgEventAction,
  orgEventPlacesLine,
  orgEventsTitle,
  orgEventWhen,
  orgEventWhere,
  pickConsentPrompt,
  registryLine,
  studentRowState,
} from "./org-helpers"

const org = (o: Partial<MyClubOrganization> = {}): MyClubOrganization => ({
  organizationId: "o-1",
  name: "Федерация БЖЖ Томской области",
  city: "Томск",
  consentGranted: false,
  consentGrantedAt: null,
  consentText: "Я разрешаю…",
  consentVersion: "2026-11-26",
  visibleInRegistry: false,
  registryLadderIds: [],
  eventsEnabled: true,
  consentCurrent: false,
  podiums: [],
  ...o,
})

describe("federationLabel", () => {
  it("names a federation once", () => {
    expect(federationLabel("Федерация БЖЖ Томской области")).toBe("Федерация БЖЖ Томской области")
    expect(federationLabel("Самбо Сибири")).toBe("Федерация «Самбо Сибири»")
  })
})

describe("consent wording", () => {
  it("speaks to the member, or to the guardian about the child", () => {
    expect(consentSwitchLabel(false)).toBe("Показывать мой пояс и записи федерации")
    expect(consentSwitchLabel(true)).toBe("Показывать пояс ребёнка и записи федерации")
    expect(consentPrivacyLine(false)).toBe("Федерация увидит ваше имя и клуб")
    expect(consentPrivacyLine(true)).toBe("Федерация увидит имя ребёнка и клуб")
  })
})

describe("pickConsentPrompt", () => {
  it("asks about the first federation not decided and not put off", () => {
    const a = org({ organizationId: "a", consentGranted: true })
    const b = org({ organizationId: "b" })
    const c = org({ organizationId: "c" })
    expect(pickConsentPrompt([a, b, c], new Set())).toBe(b)
    expect(pickConsentPrompt([a, b, c], new Set(["b"]))).toBe(c)
    expect(pickConsentPrompt([a, b, c], new Set(["b", "c"]))).toBeNull()
    expect(pickConsentPrompt([], new Set())).toBeNull()
  })
})

describe("registryLine", () => {
  it("shows the club's confirmation only under a ladder the registry really shows", () => {
    const visible = org({ consentGranted: true, visibleInRegistry: true, registryLadderIds: ["l-bjj"] })
    expect(registryLine("ACADEMY", "l-bjj", [visible])).toBe(
      "Подтверждён клубом ACADEMY · в реестре: Федерация БЖЖ Томской области",
    )
    // A ladder that is not a copy of the federation's standard.
    expect(registryLine("ACADEMY", "l-mma", [visible])).toBeNull()
    // Consented, but the club does not share its registry.
    expect(registryLine("ACADEMY", "l-bjj", [org({ consentGranted: true })])).toBeNull()
    expect(registryLine("ACADEMY", "l-bjj", [])).toBeNull()
  })
})

describe("orgEventAction", () => {
  const open = { audience: "STAFF_AND_MEMBERS" as const, registrationState: "OPEN" as const, myRegistration: null }

  it("lets a member sign up while open, says why not when full or closed", () => {
    expect(orgEventAction(open, false)).toEqual({ kind: "register" })
    expect(orgEventAction({ ...open, registrationState: "FULL" }, false)).toEqual({ kind: "full" })
    expect(orgEventAction({ ...open, registrationState: "CLOSED" }, false)).toEqual({ kind: "closed" })
  })

  it("shows the member's booking, cancellable until registration closes", () => {
    const booked = { ...open, myRegistration: { id: "r-1", status: "BOOKED" as const } }
    expect(orgEventAction(booked, false)).toEqual({ kind: "booked", registrationId: "r-1", canCancel: true })
    // A booking holds a place even when the event is full.
    expect(orgEventAction({ ...booked, registrationState: "FULL" }, false)).toMatchObject({ kind: "booked", canCancel: true })
    expect(orgEventAction({ ...booked, registrationState: "CLOSED" }, false)).toMatchObject({ canCancel: false })
    // A cancelled booking can be made again.
    expect(orgEventAction({ ...open, myRegistration: { id: "r-1", status: "CANCELLED" } }, false)).toEqual({ kind: "register" })
  })

  it("has the staff sign students up for a members' event, themselves for a coaches' one", () => {
    expect(orgEventAction(open, true)).toEqual({ kind: "none" })
    expect(canRegisterStudents(open, true)).toBe(true)
    expect(canRegisterStudents(open, false)).toBe(false)
    expect(canRegisterStudents({ ...open, registrationState: "CLOSED" }, true)).toBe(false)
    const seminar = { ...open, audience: "STAFF" as const }
    expect(orgEventAction(seminar, true)).toEqual({ kind: "register" })
    expect(canRegisterStudents(seminar, true)).toBe(false)
  })
})

describe("event lines", () => {
  it("reads places left to members and places taken to the staff", () => {
    expect(orgEventPlacesLine({ capacity: 200, bookedCount: 23 }, false)).toBe("Свободно 177 из 200")
    expect(orgEventPlacesLine({ capacity: 200, bookedCount: 200 }, false)).toBe("Мест нет")
    expect(orgEventPlacesLine({ capacity: 200, bookedCount: 23 }, true)).toBe("Записано 23 из 200")
    expect(orgEventPlacesLine({ capacity: null, bookedCount: 4 }, false)).toBeNull()
    expect(orgEventPlacesLine({ capacity: null, bookedCount: 4 }, true)).toBe("Записано 4")
  })

  it("shows the organiser's wall clock", () => {
    const when = orgEventWhen("2026-12-20T03:00:00.000Z", "2026-12-20T11:00:00.000Z", "Asia/Tomsk")
    expect(when).toMatch(/^20 дек\.?, 10:00 – 18:00$/)
    expect(orgEventWhen("2026-12-20T03:00:00.000Z", null, "Asia/Tomsk")).toMatch(/^20 дек\.?, 10:00$/)
    expect(orgEventWhen("2026-12-20T03:00:00.000Z", "2026-12-21T11:00:00.000Z", "Asia/Tomsk")).toMatch(/– 21 дек\.?, 18:00$/)
  })

  it("says where and which club hosts it", () => {
    expect(orgEventWhere({ place: "СК «Дворец спорта»", address: "Томск, ул. Красноармейская, 126", hostClubName: "ACADEMY" })).toBe(
      "СК «Дворец спорта», Томск, ул. Красноармейская, 126 · принимает ACADEMY",
    )
    expect(orgEventWhere({ place: null, address: null, hostClubName: null })).toBeNull()
  })

  it("titles the section with the federation's name", () => {
    expect(orgEventsTitle([{ organizationName: "Федерация БЖЖ Томской области" }, { organizationName: "Федерация БЖЖ Томской области" }])).toBe(
      "Федерация БЖЖ Томской области",
    )
    expect(orgEventsTitle([{ organizationName: "А" }, { organizationName: "Б" }])).toBe("События федераций")
  })
})

describe("studentRowState", () => {
  it("books only students who consented, cancels only what this coach may cancel", () => {
    expect(studentRowState({ consented: true, registration: null })).toBe("available")
    expect(studentRowState({ consented: false, registration: null })).toBe("noConsent")
    expect(studentRowState({ consented: true, registration: { status: "BOOKED", canCancel: true } })).toBe("booked")
    expect(studentRowState({ consented: true, registration: { status: "BOOKED", canCancel: false } })).toBe("bookedLocked")
    expect(studentRowState({ consented: true, registration: { status: "CANCELLED", canCancel: false } })).toBe("available")
  })
})

describe("filterStudentsByName", () => {
  const students = [{ name: "Артём Фёдоров" }, { name: "Анна Ильина" }, { name: "Фёдор Титов" }]
  it("matches every word, ignoring case and «ё»", () => {
    expect(filterStudentsByName(students, "федор")).toEqual([{ name: "Артём Фёдоров" }, { name: "Фёдор Титов" }])
    expect(filterStudentsByName(students, "  артем  ФЁД ")).toEqual([{ name: "Артём Фёдоров" }])
    expect(filterStudentsByName(students, "иванов")).toEqual([])
  })
  it("keeps everyone for an empty query", () => {
    expect(filterStudentsByName(students, "  ")).toEqual(students)
  })
})
