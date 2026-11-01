import { SetMetadata } from '@nestjs/common'

export const SKIP_CONSENT_CHECK = 'skipConsentCheck'

// Used by AuthGuard. Lets a signed-in user who has not accepted the current
// personal-data consent reach the route. Only for what the consent screen
// itself needs: reading the profile, reading/accepting the consent, exporting
// one's own data, deleting the account (= withdrawing consent) and dropping a
// push token on sign-out. Method- or class-level; the allowed set is pinned in
// consent-exempt-routes.spec.ts.
export const SkipConsentCheck = () => SetMetadata(SKIP_CONSENT_CHECK, true)
