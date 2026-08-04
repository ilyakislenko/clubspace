import { ForbiddenError } from '../errors/shared.errors'

// Platform-scope counterpart to assertWorkspaceAdmin. Handlers for `/platform/*`
// call this even though SuperAdminGuard already ran, because the repo's rule is
// that authorization lives in the handler — a slice reachable from a bus, a
// test, or a future controller that forgets the guard must still refuse.
//
// There is no workspace in scope here, so nothing to resolve: platform power is
// a property of the user, not of a membership.
export const assertPlatformAdmin = (
    isSuperAdmin: boolean,
    message = 'Platform administrator access required',
): void => {
    if (!isSuperAdmin) {
        throw new ForbiddenError({ message })
    }
}
