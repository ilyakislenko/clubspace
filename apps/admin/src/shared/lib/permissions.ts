// Mirror of the server-side capability tiers in
// apps/server/src/shared/decorators/roles.decorator.ts: CLUB_ADMINS (money &
// system) and SPORT_LEADS (sport & operations). Keeping them duplicated
// client-side lets us hide buttons before the user clicks them and gets a
// 403 — server still enforces the same rules, this is purely UX polish.
// The owner passes every tier regardless of role row.

export type RoleName =
  | "user"
  | "coach"
  | "head_coach"
  | "admin"

export type CurrentMembership = {
  role: string
  isOwner: boolean
  // Directions this coach runs as «руководитель направления». Empty for
  // sport leads (they run everything) and for plain coaches.
  managedDirectionIds?: readonly string[]
}

const STAFF = new Set(["admin", "head_coach", "coach"])
const COACHING = new Set(["admin", "head_coach", "coach"])
const CLUB_ADMINS = new Set(["admin"])
const SPORT_LEADS = new Set(["admin", "head_coach"])

export const isStaff = (m: CurrentMembership | null | undefined): boolean =>
  !!m && (m.isOwner || STAFF.has(m.role))

export const canManageGroups = (
  m: CurrentMembership | null | undefined,
): boolean => !!m && (m.isOwner || COACHING.has(m.role))

// Money & system: payments, tariffs, billing, settings, roles, import,
// exports, audit, integrations — what the server gates with CLUB_ADMINS.
export const isClubAdmin = (
  m: CurrentMembership | null | undefined,
): boolean => !!m && (m.isOwner || CLUB_ADMINS.has(m.role))

// Sport & operations across the whole club (roster, gyms, ranks, gradings,
// coaches comparison) — what the server gates with SPORT_LEADS.
export const isSportLead = (
  m: CurrentMembership | null | undefined,
): boolean => !!m && (m.isOwner || SPORT_LEADS.has(m.role))

// May invite with, remove or change the access of a member holding this role.
// Staff roles are the club admins' to hand out or act on; a sport lead runs
// students and parents only — mirror of the server's assertCanManageRoles.
export const canActOnRole = (
  m: CurrentMembership | null | undefined,
  roleName: string | null | undefined,
): boolean =>
  isClubAdmin(m) || (isSportLead(m) && !STAFF.has(roleName ?? ""))

// A coach assigned to run one or more directions. Sport leads are never
// counted here — they already manage every direction.
export const isDirectionManager = (
  m: CurrentMembership | null | undefined,
): boolean =>
  !!m && !isSportLead(m) && (m.managedDirectionIds?.length ?? 0) > 0

// May create/edit rows tagged with this direction in the sections the server
// opens to direction managers. Sport lead → always; manager → only their own
// (never club-wide `null`); everyone else → never.
export const canManageDirection = (
  m: CurrentMembership | null | undefined,
  directionId: string | null | undefined,
): boolean => {
  if (isSportLead(m)) return true
  if (!m || !directionId) return false
  return m.managedDirectionIds?.includes(directionId) ?? false
}

// Who may open a section: `clubAdmin` and `sportLead` are the server tiers;
// `lead` also lets direction managers in (scoped to their directions);
// `staff` is everyone the admin app lets in, plain coaches included.
export type Access = "clubAdmin" | "sportLead" | "lead" | "staff"

export const hasAccess = (
  m: CurrentMembership | null | undefined,
  access: Access,
): boolean => {
  switch (access) {
    case "clubAdmin":
      return isClubAdmin(m)
    case "sportLead":
      return isSportLead(m)
    case "lead":
      return isSportLead(m) || isDirectionManager(m)
    case "staff":
      return true
  }
}

// Gated nav items stay hidden until the membership has loaded, so nobody
// sees a link that would 403.
export const visibleNavItems = <T extends { access: Access }>(
  items: readonly T[],
  m: CurrentMembership | null | undefined,
): T[] => items.filter((item) => hasAccess(m, item.access))
