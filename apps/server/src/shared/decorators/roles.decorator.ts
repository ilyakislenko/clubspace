import { Reflector } from '@nestjs/core'

// Canonical role names that map to Role.name in the DB. Keeping the list
// in code (rather than a computed lookup) keeps autocomplete honest and
// makes accidental typos a compile-time error.
export type RoleName =
    | 'user'
    | 'coach'
    | 'head_coach'
    | 'admin'
    | 'moderator'

// Capability tiers — every controller picks one of these instead of
// open-coding the role list. Renaming a tier here updates everything
// at once; adding a new role is one edit per tier it belongs to.
//
// STAFF_ROLES        — anyone with admin-side access (read at minimum).
//                      'user' is the mobile-only role and is never here.
// COACHING_ROLES     — can manage groups, students of those groups, and
//                      the content library.
// WORKSPACE_ADMINS   — top-level workspace admin only. Things like
//                      changing roles, deleting gyms, managing the
//                      member roster. Coach is intentionally absent.
export const STAFF_ROLES: RoleName[] = [
    'admin',
    'head_coach',
    'coach',
    'moderator',
]
export const COACHING_ROLES: RoleName[] = ['admin', 'head_coach', 'coach']
export const WORKSPACE_ADMINS: RoleName[] = ['admin', 'head_coach']

// Used by RoleGuard. Endpoints that don't carry @Roles() are open to any
// authenticated workspace member (subject to AuthGuard / WorkspaceMemberGuard).
export const Roles = Reflector.createDecorator<RoleName[]>()
