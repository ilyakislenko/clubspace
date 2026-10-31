import { SetMetadata } from '@nestjs/common'

export const ALLOW_SUSPENDED_WORKSPACE = 'allowSuspendedWorkspace'

// Used by WorkspaceMemberGuard. Lets a request through to a club that is
// suspended (billing) or switched off by the platform — only for what the
// staff need to see the state and get the club paid for: their own membership
// (the admin's role gates) and the billing page. Method-level only; pinned in
// route-tier-consistency.spec.ts.
export const AllowSuspendedWorkspace = () =>
    SetMetadata(ALLOW_SUSPENDED_WORKSPACE, true)
