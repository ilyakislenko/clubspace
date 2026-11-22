import type { ScheduleSession } from "../../shared/api/groups"
import {
  canMarkSession,
  classPersonLabel,
  isAdminScope,
  markOnRow,
  runsGroupOf,
  type StaffViewer,
  substitutionActions,
  substitutionLine,
} from "./substitution-helpers"

const NOW = new Date("2026-11-02T09:00:00Z").getTime()

const person = (id: string, firstname: string | null, lastname: string | null) => ({
  id,
  email: `${id}@club.ru`,
  firstname,
  lastname,
})

const session = (over: Partial<ScheduleSession> = {}): ScheduleSession => ({
  occurrenceId: "slot-1:2026-11-05",
  slotId: "slot-1",
  groupId: "g1",
  group: {
    id: "g1",
    name: "Вечер",
    gym: null,
    direction: { id: "bjj", name: "БЖЖ" } as never,
    coach: person("lead", "Яна", "Иванова"),
  },
  timezone: "Europe/Moscow",
  startAt: "2026-11-05T16:00:00Z",
  endAt: "2026-11-05T17:00:00Z",
  durationMin: 60,
  dayOfWeek: 4,
  cancelled: false,
  cancellationReason: null,
  substitution: null,
  ...over,
})

const pending = (substituteId = "me", requestedById = substituteId) =>
  ({
    id: "sub1",
    status: "PENDING",
    kind: "OFFER",
    substitute: person(substituteId, "Олег", "Петров"),
    requestedById,
  }) as const

const approved = (substituteId = "me", requestedById = "lead") =>
  ({
    id: "sub1",
    status: "APPROVED",
    kind: "ASSIGN",
    substitute: person(substituteId, "Олег", "Петров"),
    requestedById,
  }) as const

// A plain coach of another group by default.
const viewer = (over: Partial<StaffViewer> = {}): StaffViewer => ({
  meId: "me",
  adminScope: false,
  marksAnyClass: false,
  coachGroupIds: new Set(["g2"]),
  managedDirectionIds: new Set(),
  ...over,
})
const headCoach = viewer({ meId: "head", adminScope: true, marksAnyClass: true })
const groupCoach = viewer({ meId: "lead", coachGroupIds: new Set(["g1"]) })

describe("isAdminScope", () => {
  it("owner, admin and head coach run every group; a coach does not", () => {
    expect(isAdminScope({ roleName: "coach", isOwner: true })).toBe(true)
    expect(isAdminScope({ roleName: "admin", isOwner: false })).toBe(true)
    expect(isAdminScope({ roleName: "head_coach", isOwner: false })).toBe(true)
    expect(isAdminScope({ roleName: "coach", isOwner: false })).toBe(false)
  })
})

describe("runsGroupOf", () => {
  it("admin scope, the group's coach and its direction's manager run it", () => {
    expect(runsGroupOf(session(), headCoach)).toBe(true)
    expect(runsGroupOf(session(), groupCoach)).toBe(true)
    expect(
      runsGroupOf(session(), viewer({ managedDirectionIds: new Set(["bjj"]) })),
    ).toBe(true)
  })

  it("a coach of another group or direction does not", () => {
    expect(runsGroupOf(session(), viewer())).toBe(false)
    expect(
      runsGroupOf(session(), viewer({ managedDirectionIds: new Set(["mma"]) })),
    ).toBe(false)
    // A club-wide group has no direction to manage.
    const clubWide = session({
      group: { ...session().group, direction: null },
    })
    expect(
      runsGroupOf(clubWide, viewer({ managedDirectionIds: new Set(["bjj"]) })),
    ).toBe(false)
  })
})

describe("canMarkSession", () => {
  it("whoever runs the group marks it", () => {
    expect(canMarkSession(session(), headCoach)).toBe(true)
    expect(canMarkSession(session(), groupCoach)).toBe(true)
  })

  it("a plain coach marks only as the approved substitute", () => {
    expect(canMarkSession(session(), viewer())).toBe(false)
    expect(canMarkSession(session({ substitution: pending() }), viewer())).toBe(
      false,
    )
    expect(canMarkSession(session({ substitution: approved() }), viewer())).toBe(
      true,
    )
    expect(
      canMarkSession(session({ substitution: approved("other") }), viewer()),
    ).toBe(false)
    expect(
      canMarkSession(
        session({ substitution: approved() }),
        viewer({ meId: null }),
      ),
    ).toBe(false)
  })

  it("marks every class while the club allows it", () => {
    expect(canMarkSession(session(), viewer({ marksAnyClass: true }))).toBe(true)
  })

  it("nobody marks a cancelled class", () => {
    expect(canMarkSession(session({ cancelled: true }), headCoach)).toBe(false)
    expect(
      canMarkSession(
        session({ cancelled: true, substitution: approved() }),
        viewer({ marksAnyClass: true }),
      ),
    ).toBe(false)
  })
})

describe("substitutionLine", () => {
  it("names the approved substitute to everyone", () => {
    expect(substitutionLine(session({ substitution: approved() }), false)).toBe(
      "Замена: О. Петров",
    )
  })

  it("shows a pending request to staff only", () => {
    const s = session({ substitution: pending() })
    expect(substitutionLine(s, true)).toBe("Запрос на замену: О. Петров")
    expect(substitutionLine(s, false)).toBeNull()
  })

  it("is null without a substitution (or on a cached payload without one)", () => {
    expect(substitutionLine(session(), true)).toBeNull()
    expect(substitutionLine(session({ substitution: undefined }), true)).toBeNull()
  })
})

describe("substitutionActions", () => {
  it("no substitution: who runs the group assigns, another coach offers, its own coach nothing extra", () => {
    expect(substitutionActions(session(), headCoach, NOW)).toEqual(["assign"])
    expect(substitutionActions(session(), groupCoach, NOW)).toEqual(["assign"])
    expect(substitutionActions(session(), viewer(), NOW)).toEqual(["take"])
    // An assistant counted in coachGroupIds runs it.
    expect(
      substitutionActions(session(), viewer({ coachGroupIds: new Set(["g1"]) }), NOW),
    ).toEqual(["assign"])
  })

  it("pending: who runs the group decides, the requester withdraws, others see nothing", () => {
    const s = session({ substitution: pending("me") })
    expect(substitutionActions(s, headCoach, NOW)).toEqual(["approve", "decline"])
    expect(substitutionActions(s, groupCoach, NOW)).toEqual(["approve", "decline"])
    expect(substitutionActions(s, viewer(), NOW)).toEqual(["withdraw"])
    expect(substitutionActions(s, viewer({ meId: "other" }), NOW)).toEqual([])
  })

  it("approved: who runs the group swaps or cancels, the substitute cancels, others nothing", () => {
    const s = session({ substitution: approved("me") })
    expect(substitutionActions(s, headCoach, NOW)).toEqual(["assign", "cancel"])
    expect(substitutionActions(s, groupCoach, NOW)).toEqual(["assign", "cancel"])
    expect(substitutionActions(s, viewer(), NOW)).toEqual(["cancel"])
    expect(substitutionActions(s, viewer({ meId: "other" }), NOW)).toEqual([])
    // Whoever asked for it may call it off too.
    expect(
      substitutionActions(
        session({ substitution: approved("x", "me") }),
        viewer(),
        NOW,
      ),
    ).toEqual(["cancel"])
  })

  it("offers nothing on a cancelled class or one more than a week past", () => {
    expect(substitutionActions(session({ cancelled: true }), headCoach, NOW)).toEqual(
      [],
    )
    const old = session({
      startAt: "2026-10-25T16:00:00Z",
      endAt: "2026-10-25T17:00:00Z",
    })
    expect(substitutionActions(old, headCoach, NOW)).toEqual([])
    // Within the week the server still records it.
    const recent = session({
      startAt: "2026-10-30T16:00:00Z",
      endAt: "2026-10-30T17:00:00Z",
    })
    expect(substitutionActions(recent, viewer(), NOW)).toEqual(["take"])
  })
})

describe("classPersonLabel", () => {
  it("names the group's coach, but not to the coach themselves", () => {
    expect(classPersonLabel(session(), "me")).toBe("Я. Иванова")
    expect(classPersonLabel(session(), "lead")).toBeNull()
  })

  it("names an approved substitute instead, unless the viewer is the substitute", () => {
    const s = session({ substitution: approved("sub") })
    expect(classPersonLabel(s, "lead")).toBe("Замена: О. Петров")
    expect(classPersonLabel(s, "sub")).toBeNull()
  })

  it("keeps the coach while a substitution is only requested", () => {
    expect(classPersonLabel(session({ substitution: pending("sub") }), "me")).toBe(
      "Я. Иванова",
    )
  })
})

describe("markOnRow", () => {
  // The class runs 19:00–20:00 Moscow time (16:00–17:00Z) on 5 November.
  const at = (iso: string) => new Date(iso)
  const mine = new Set(["g1"])

  it("shows from 30 minutes before the start to the end of the class's day", () => {
    expect(markOnRow(session(), "lead", mine, at("2026-11-05T15:20:00Z"))).toBe(false)
    expect(markOnRow(session(), "lead", mine, at("2026-11-05T15:31:00Z"))).toBe(true)
    expect(markOnRow(session(), "lead", mine, at("2026-11-05T16:30:00Z"))).toBe(true)
    // Ended an hour ago, still the same evening.
    expect(markOnRow(session(), "lead", mine, at("2026-11-05T18:00:00Z"))).toBe(true)
    expect(markOnRow(session(), "lead", mine, at("2026-11-06T06:00:00Z"))).toBe(false)
  })

  it("reads «today» in the class's zone, not UTC", () => {
    // 00:30 in Moscow on the 6th, while UTC is still on the 5th.
    expect(markOnRow(session(), "lead", mine, at("2026-11-05T21:30:00Z"))).toBe(false)
  })

  it("is only for the viewer's own class", () => {
    const now = at("2026-11-05T16:30:00Z")
    // Another group's coach, and admin scope without coaching the group.
    expect(markOnRow(session(), "me", new Set(["g2"]), now)).toBe(false)
    expect(markOnRow(session(), "head", new Set(), now)).toBe(false)
    // The group's coach, known by the coach id even without the group list.
    expect(markOnRow(session(), "lead", new Set(), now)).toBe(true)
  })

  it("follows an approved substitution to the substitute", () => {
    const now = at("2026-11-05T16:30:00Z")
    const s = session({ substitution: approved("sub") })
    expect(markOnRow(s, "sub", new Set(["g2"]), now)).toBe(true)
    expect(markOnRow(s, "lead", mine, now)).toBe(false)
    // A pending request leaves the class with its coach.
    const asked = session({ substitution: pending("sub") })
    expect(markOnRow(asked, "lead", mine, now)).toBe(true)
  })

  it("never on a cancelled class", () => {
    expect(
      markOnRow(session({ cancelled: true }), "lead", mine, at("2026-11-05T16:30:00Z")),
    ).toBe(false)
  })
})
