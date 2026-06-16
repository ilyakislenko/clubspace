import {
  canManageGroups,
  isStaff,
  isWorkspaceAdmin,
  type CurrentMembership,
} from "./permissions"

const m = (role: string, isOwner = false): CurrentMembership => ({
  role,
  isOwner,
})

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
    it("allows owner + any staff role (incl. moderator)", () => {
      expect(isStaff(m("user", true))).toBe(true)
      expect(isStaff(m("moderator"))).toBe(true)
      expect(isStaff(m("coach"))).toBe(true)
    })
    it("rejects plain user / nullish", () => {
      expect(isStaff(m("user"))).toBe(false)
      expect(isStaff(null)).toBe(false)
      expect(isStaff(undefined)).toBe(false)
    })
  })
})
