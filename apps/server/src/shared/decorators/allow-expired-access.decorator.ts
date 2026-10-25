import { Reflector } from '@nestjs/core'

// Used by WorkspaceMemberGuard. Lets a member whose access window has expired
// (accessUntil in the past) still reach the route — only that one check is
// skipped; the membership and ACTIVE-status checks stay. For the few reads the
// lock screen needs (club contacts). Pinned in route-tier-consistency.spec.ts.
export const AllowExpiredAccess = Reflector.createDecorator<boolean>()
