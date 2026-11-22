import { environment } from '../../environments/environment'

// Whether a super admin's session may use platform powers: the /platform
// console and the super-admin bypass of every club guard (both read
// CurrentUserPayload.isSuperAdmin, which AuthGuard sets from this). With
// PLATFORM_ADMIN_MFA_REQUIRED only a sign-in that also proved the account's
// authenticator (the access token's `mfa` claim) does; without it the account
// is an ordinary user in this session.
export const superAdminSessionAllowed = (claims: { mfa?: unknown }): boolean =>
    !environment.platformAdminMfaRequired || claims.mfa === true
