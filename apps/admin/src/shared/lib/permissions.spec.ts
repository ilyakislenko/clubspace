import {
  canManageDirection,
  canManageGroups,
  isDirectionManager,
  isStaff,
  isWorkspaceAdmin,
  visibleNavItems,
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

const manager = m("coach", false, ["bjj", "mma"])

describe("permission tiers", () => {
  describe("isWorkspaceAdmin", () => {
    it("passes the owner regardless of role", () => {
      expect(isWorkspaceAdmin(m("user", true))).toBe(true)
    })
    it("passes admin / head_coach", () => {
      expect(isWorkspaceAdmin(m("admin"))).toBe(true)
      expect(isWorkspaceAdmin(m("head_coach"))).toBe(true)
    })
    it("rejects coach / moderator / user", () => {
      expect(isWorkspaceAdmin(m("coach"))).toBe(false)
      expect(isWorkspaceAdmin(m("moderator"))).toBe(false)
      expect(isWorkspaceAdmin(m("user"))).toBe(false)
    })
    it("rejects null/undefined membership", () => {
      expect(isWorkspaceAdmin(null)).toBe(false)
      expect(isWorkspaceAdmin(undefined)).toBe(false)
    })
  })

  describe("canManageGroups", () => {
    it("allows owner + coaching tier (admin/head_coach/coach)", () => {
      expect(canManageGroups(m("user", true))).toBe(true)
      expect(canManageGroups(m("admin"))).toBe(true)
      expect(canManageGroups(m("head_coach"))).toBe(true)
      expect(canManageGroups(m("coach"))).toBe(true)
    })
    it("rejects moderator / user / nullish", () => {
      expect(canManageGroups(m("moderator"))).toBe(false)
      expect(canManageGroups(m("user"))).toBe(false)
      expect(canManageGroups(null)).toBe(false)
    })
  })

  describe("isStaff", () => {
    it("allows owner + any staff role", () => {
      expect(isStaff(m("user", true))).toBe(true)
      expect(isStaff(m("coach"))).toBe(true)
    })
    it("rejects plain user / moderator / nullish", () => {
      expect(isStaff(m("user"))).toBe(false)
      expect(isStaff(m("moderator"))).toBe(false)
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
    it("admins manage every direction and club-wide rows", () => {
      expect(isDirectionManager(m("admin"))).toBe(false)
      expect(canManageDirection(m("admin"), "boxing")).toBe(true)
      expect(canManageDirection(m("head_coach"), null)).toBe(true)
    })
    it("a plain coach manages nothing", () => {
      expect(isDirectionManager(m("coach"))).toBe(false)
      expect(canManageDirection(m("coach"), "bjj")).toBe(false)
      expect(canManageDirection(null, "bjj")).toBe(false)
    })
  })

  describe("visibleNavItems", () => {
    const items = [
      { key: "users" },
      { key: "ranks", adminOrDirectionManager: true },
      { key: "settings", adminOnly: true },
    ]
    const keys = (mm: CurrentMembership | null) =>
      visibleNavItems(items, mm).map((i) => i.key)

    it("hides gated items until the membership has loaded", () => {
      expect(keys(null)).toEqual(["users"])
    })
    it("hides gated items from plain coaches", () => {
      expect(keys(m("coach"))).toEqual(["users"])
    })
    it("shows direction-manager sections, not admin ones, to a manager", () => {
      expect(keys(manager)).toEqual(["users", "ranks"])
    })
    it("shows everything to admin, head_coach and the owner", () => {
      expect(keys(m("admin"))).toEqual(["users", "ranks", "settings"])
      expect(keys(m("head_coach"))).toEqual(["users", "ranks", "settings"])
      expect(keys(m("coach", true))).toEqual(["users", "ranks", "settings"])
    })
  })
})
