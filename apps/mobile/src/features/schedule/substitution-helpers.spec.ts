import type { ScheduleSession } from "../../shared/api/groups"
import {
  canMarkSession,
  isAdminScope,
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
