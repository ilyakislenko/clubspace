import { SetMetadata } from '@nestjs/common'

// Request header a guardian sends to act for one of their dependents (a child
// profile without a login). Read by AuthGuard.
export const ACT_AS_HEADER = 'x-act-as'

export const ACT_AS_ALLOWED = 'actAsAllowed'

// Used by AuthGuard. Workspace-scoped member routes accept X-Act-As without
// this; a user-level route (no workspace in the request) refuses it unless
// marked here — account, device and guardian routes must always act as the
// signed-in person. Method-level only; pinned in route-tier-consistency.spec.ts.
export const ActAsAllowed = () => SetMetadata(ACT_AS_ALLOWED, true)
