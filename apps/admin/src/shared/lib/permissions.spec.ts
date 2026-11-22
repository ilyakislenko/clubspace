import {
  canActOnRole,
  canManageDirection,
  canManageGroups,
  hasAccess,
  isClubAdmin,
  isDirectionManager,
  isSportLead,
  isStaff,
  visibleNavItems,
  type Access,
  type CurrentMembership,
} from "./permissions"

const m = (
  role: string,
  isOwner = false,
  managedDirectionIds: string[] = [],
): CurrentMembership => ({
  role,
  isOwner,
  managedDirectionIds,
})

const owner = m("user", true)
const admin = m("admin")
const headCoach = m("head_coach")
const manager = m("coach", false, ["bjj", "mma"])
const coach = m("coach")

describe("permission tiers", () => {
  describe("isClubAdmin", () => {
    it("passes the owner regardless of role, and admin", () => {
      expect(isClubAdmin(owner)).toBe(true)
      expect(isClubAdmin(admin)).toBe(true)
    })
    it("rejects head_coach, direction managers, coaches and students", () => {
      expect(isClubAdmin(headCoach)).toBe(false)
      expect(isClubAdmin(manager)).toBe(false)
      expect(isClubAdmin(coach)).toBe(false)
      expect(isClubAdmin(m("user"))).toBe(false)
    })
    it("rejects null/undefined membership", () => {
      expect(isClubAdmin(null)).toBe(false)
      expect(isClubAdmin(undefined)).toBe(false)
    })
  })

  describe("isSportLead", () => {
    it("passes the owner, admin and head_coach", () => {
      expect(isSportLead(owner)).toBe(true)
      expect(isSportLead(admin)).toBe(true)
      expect(isSportLead(headCoach)).toBe(true)
    })
    it("rejects direction managers, coaches, students and nullish", () => {
      expect(isSportLead(manager)).toBe(false)
      expect(isSportLead(coach)).toBe(false)
      expect(isSportLead(m("user"))).toBe(false)
      expect(isSportLead(null)).toBe(false)
    })
  })

  describe("canActOnRole", () => {
    it("lets club admins act on any role", () => {
      for (const role of ["admin", "head_coach", "coach", "user", null]) {
        expect(canActOnRole(owner, role)).toBe(true)
        expect(canActOnRole(admin, role)).toBe(true)
      }
    })
    it("holds a head_coach to students and parents", () => {
      expect(canActOnRole(headCoach, "user")).toBe(true)
      expect(canActOnRole(headCoach, "coach")).toBe(false)
      expect(canActOnRole(headCoach, "head_coach")).toBe(false)
      expect(canActOnRole(headCoach, "admin")).toBe(false)
    })
    it("lets nobody below the sport tier act", () => {
      expect(canActOnRole(manager, "user")).toBe(false)
      expect(canActOnRole(coach, "user")).toBe(false)
      expect(canActOnRole(null, "user")).toBe(false)
    })
  })

  describe("canManageGroups", () => {
    it("allows owner + coaching tier (admin/head_coach/coach)", () => {
      expect(canManageGroups(owner)).toBe(true)
      expect(canManageGroups(admin)).toBe(true)
      expect(canManageGroups(headCoach)).toBe(true)
      expect(canManageGroups(coach)).toBe(true)
    })
    it("rejects user / nullish", () => {
      expect(canManageGroups(m("user"))).toBe(false)
      expect(canManageGroups(null)).toBe(false)
    })
  })

  describe("isStaff", () => {
    it("allows owner + any staff role", () => {
      expect(isStaff(owner)).toBe(true)
      expect(isStaff(coach)).toBe(true)
    })
    it("rejects plain user / nullish", () => {
      expect(isStaff(m("user"))).toBe(false)
      expect(isStaff(null)).toBe(false)
      expect(isStaff(undefined)).toBe(false)
    })
  })

  describe("isDirectionManager / canManageDirection", () => {
    it("a coach with assignments manages only their own directions", () => {
      expect(isDirectionManager(manager)).toBe(true)
      expect(canManageDirection(manager, "bjj")).toBe(true)
      expect(canManageDirection(manager, "boxing")).toBe(false)
      expect(canManageDirection(manager, null)).toBe(false)
    })
    it("sport leads manage every direction and club-wide rows", () => {
      expect(isDirectionManager(m("head_coach", false, ["bjj"]))).toBe(false)
      expect(canManageDirection(admin, "boxing")).toBe(true)
      expect(canManageDirection(headCoach, null)).toBe(true)
    })
    it("a plain coach manages nothing", () => {
      expect(isDirectionManager(coach)).toBe(false)
      expect(canManageDirection(coach, "bjj")).toBe(false)
      expect(canManageDirection(null, "bjj")).toBe(false)
    })
  })

  describe("hasAccess", () => {
    const levels: Access[] = ["clubAdmin", "sportLead", "lead", "staff"]
    const open = (mm: CurrentMembership | null) =>
      levels.filter((level) => hasAccess(mm, level))

    it("opens every level to the owner and admin", () => {
      expect(open(owner)).toEqual(levels)
      expect(open(admin)).toEqual(levels)
    })
    it("closes the club-admin level to head_coach", () => {
      expect(open(headCoach)).toEqual(["sportLead", "lead", "staff"])
    })
    it("opens only lead and staff to a direction manager", () => {
      expect(open(manager)).toEqual(["lead", "staff"])
    })
    it("opens only staff to a plain coach and before the membership loads", () => {
      expect(open(coach)).toEqual(["staff"])
      expect(open(null)).toEqual(["staff"])
    })
  })

  describe("visibleNavItems", () => {
    const items: { key: string; access: Access }[] = [
      { key: "users", access: "staff" },
      { key: "ranks", access: "lead" },
      { key: "coaches", access: "sportLead" },
      { key: "settings", access: "clubAdmin" },
    ]
    const keys = (mm: CurrentMembership | null) =>
      visibleNavItems(items, mm).map((i) => i.key)

    it("filters by each item's access level", () => {
      expect(keys(owner)).toEqual(["users", "ranks", "coaches", "settings"])
      expect(keys(admin)).toEqual(["users", "ranks", "coaches", "settings"])
      expect(keys(headCoach)).toEqual(["users", "ranks", "coaches"])
      expect(keys(manager)).toEqual(["users", "ranks"])
      expect(keys(coach)).toEqual(["users"])
      expect(keys(null)).toEqual(["users"])
    })
  })
})
