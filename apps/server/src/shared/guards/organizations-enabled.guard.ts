import { CanActivate, Injectable } from '@nestjs/common'

import { assertOrganizationsEnabled } from '../../domains/organizations/org-access'

// First guard of every federation-hub controller (org console, club side,
// `orgs/mine`): with ORGANIZATIONS_ENABLED off the routes answer 404 as if
// they did not exist (docs/design/2026-11-26-federation-hub-mvp.md §10).
// Runs before AuthGuard on purpose — the answer can't depend on the caller.
@Injectable()
export class OrganizationsEnabledGuard implements CanActivate {
    canActivate(): boolean {
        assertOrganizationsEnabled()
        return true
    }
}
