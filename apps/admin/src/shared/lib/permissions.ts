// Mirror of the server-side capability tiers in
// apps/server/src/shared/decorators/roles.decorator.ts. Keeping them
// duplicated client-side lets us hide buttons before the user clicks
// them and gets a 403 — server still enforces the same rules, this is
// purely UX polish.

export type RoleName =
  | "user"
  | "coach"
  | "head_coach"
  | "admin"

export type CurrentMembership = {
  role: string
  isOwner: boolean
}

const STAFF = new Set(["admin", "head_coach", "coach"])
const COACHING = new Set(["admin", "head_coach", "coach"])
const ADMINS = new Set(["admin", "head_coach"])

export const isStaff = (m: CurrentMembership | null | undefined): boolean =>
  !!m && (m.isOwner || STAFF.has(m.role))

export const canManageGroups = (
  m: CurrentMembership | null | undefined,
): boolean => !!m && (m.isOwner || COACHING.has(m.role))

// True for the head_coach / admin tier — what the server gates with
// WORKSPACE_ADMINS. Owner always passes regardless of role row.
export const isWorkspaceAdmin = (
  m: CurrentMembership | null | undefined,
): boolean => !!m && (m.isOwner || ADMINS.has(m.role))

// Nav items marked adminOnly stay hidden until the membership has loaded and
// is admin-level, so a coach never sees a link that would 403.
export const visibleNavItems = <T extends { adminOnly?: boolean }>(
  items: readonly T[],
  m: CurrentMembership | null | undefined,
): T[] => items.filter((item) => !item.adminOnly || isWorkspaceAdmin(m))
