import { z } from 'zod'

// The platform admin's authenticator (TOTP). Reachable without the platform
// powers it unlocks: a super admin whose session lacks it is an ordinary user
// (CurrentUserPayload), so each feature carries whether the account is a
// platform admin at all.
export const GetPlatformMfaOutputSchema = z.object({
    // A confirmed authenticator; sign-in asks for its code.
    enrolled: z.boolean(),
    // PLATFORM_ADMIN_MFA_REQUIRED.
    required: z.boolean(),
    // Whether this session has the platform powers. False while required and
    // the session was not signed in with the authenticator — set it up, or
    // sign in again with it.
    accessGranted: z.boolean(),
})

export const StartPlatformMfaEnrollmentOutputSchema = z.object({
    // Base32, for typing into the app by hand.
    secret: z.string(),
    otpauthUrl: z.string(),
    // PNG data URI of otpauthUrl, so the admin just shows an <img>.
    qrPngDataUrl: z.string(),
})

export const ConfirmPlatformMfaEnrollmentInputSchema = z.object({
    code: z.string().regex(/^\d{6}$/),
})

export const ConfirmPlatformMfaEnrollmentOutputSchema = z.object({
    enrolled: z.literal(true),
})

type PlatformMfaCaller = {
    invokerUserId: string
    // isSuperAdmin || superAdminMfaMissing: a super-admin account, whatever
    // this session may do.
    platformAccount: boolean
    accessGranted: boolean
}

export class GetPlatformMfaFeature {
    constructor(readonly caller: PlatformMfaCaller) {}
}

export class StartPlatformMfaEnrollmentFeature {
    constructor(readonly caller: PlatformMfaCaller) {}
}

export class ConfirmPlatformMfaEnrollmentFeature {
    constructor(
        readonly payload: z.infer<typeof ConfirmPlatformMfaEnrollmentInputSchema>,
        readonly caller: PlatformMfaCaller,
    ) {}
}

export type GetPlatformMfaFeatureResponse = z.infer<
    typeof GetPlatformMfaOutputSchema
>
export type StartPlatformMfaEnrollmentFeatureResponse = z.infer<
    typeof StartPlatformMfaEnrollmentOutputSchema
>
export type ConfirmPlatformMfaEnrollmentFeatureResponse = z.infer<
    typeof ConfirmPlatformMfaEnrollmentOutputSchema
>
