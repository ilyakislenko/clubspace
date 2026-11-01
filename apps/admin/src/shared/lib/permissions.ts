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
  // Directions this coach runs as «руководитель направления». Empty for
  // admins (they run everything) and for plain coaches.
  managedDirectionIds?: readonly string[]
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

// A coach assigned to run one or more directions. Admins are never counted
// here — they already manage every direction.
export const isDirectionManager = (
  m: CurrentMembership | null | undefined,
): boolean =>
  !!m && !isWorkspaceAdmin(m) && (m.managedDirectionIds?.length ?? 0) > 0

// May create/edit rows tagged with this direction in the sections the server
// opens to direction managers. Admin → always; manager → only their own
// (never club-wide `null`); everyone else → never.
export const canManageDirection = (
  m: CurrentMembership | null | undefined,
  directionId: string | null | undefined,
): boolean => {
  if (isWorkspaceAdmin(m)) return true
  if (!m || !directionId) return false
  return m.managedDirectionIds?.includes(directionId) ?? false
}

// Nav items stay hidden until the membership has loaded: adminOnly ones need
// the admin tier, adminOrDirectionManager ones also open to direction
// managers — so a plain coach never sees a link that would 403.
export const visibleNavItems = <
  T extends { adminOnly?: boolean; adminOrDirectionManager?: boolean },
>(
  items: readonly T[],
  m: CurrentMembership | null | undefined,
): T[] =>
  items.filter((item) => {
    if (item.adminOnly) return isWorkspaceAdmin(m)
    if (item.adminOrDirectionManager)
      return isWorkspaceAdmin(m) || isDirectionManager(m)
    return true
  })
