import { Reflector } from '@nestjs/core'

// Canonical role names that map to Role.name in the DB. Keeping the list
// in code (rather than a computed lookup) keeps autocomplete honest and
// makes accidental typos a compile-time error.
export type RoleName =
    | 'user'
    | 'coach'
    | 'head_coach'
    | 'admin'

// Capability tiers — every controller picks one of these instead of
// open-coding the role list. Renaming a tier here updates everything
// at once; adding a new role is one edit per tier it belongs to.
//
// STAFF_ROLES        — anyone with admin-side access (read at minimum).
//                      'user' is the mobile-only role and is never here.
// COACHING_ROLES     — can manage groups, students of those groups, and
//                      the content library.
// SPORT_LEADS        — run the club's training side across every group:
//                      roster of students and parents, gyms, renewals,
//                      abonements and freezes. Coach is intentionally absent.
// CLUB_ADMINS        — money and system: tariffs, refunds, payment keys,
//                      the ClubSpace subscription, revenue, settings, staff
//                      roles, public page, integrations, import, exports,
//                      audit log. The head coach is a sport role and is not
//                      here. The owner passes both (AuthGuard resolves them
//                      to 'admin').
export const COACHING_ROLES: RoleName[] = ['admin', 'head_coach', 'coach']
export const STAFF_ROLES: RoleName[] = [...COACHING_ROLES]
export const SPORT_LEADS: RoleName[] = ['admin', 'head_coach']
export const CLUB_ADMINS: RoleName[] = ['admin']

// Roles a club admin may hand out from the workspace UI. The Role table is
// global, so anything else (platform roles, legacy rows) must be refused.
export const GRANTABLE_ROLE_NAMES: RoleName[] = [
    'user',
    'coach',
    'head_coach',
    'admin',
]

// Used by RoleGuard. Endpoints that don't carry @Roles() are open to any
// authenticated workspace member (subject to AuthGuard / WorkspaceMemberGuard).
export const Roles = Reflector.createDecorator<RoleName[]>()
