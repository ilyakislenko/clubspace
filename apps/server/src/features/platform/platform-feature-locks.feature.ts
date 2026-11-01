import { z } from 'zod'

import { APP_FEATURE_KEYS } from '../../domains/workspace/feature-flags'
import { PlatformWorkspaceBillingOutputSchema } from './platform-workspace-billing-view'

// The platform owner pins one of a club's app sections on or off: the
// `<feature>Enabled` column is set to `enabled` and the club's admin cannot
// change it while the lock holds — through `until` (inclusive, Moscow), or
// until unlocked when absent/null. Locking again replaces the lock.
export const LockPlatformWorkspaceFeatureInputSchema = z.object({
    feature: z.enum(APP_FEATURE_KEYS),
    enabled: z.boolean(),
    until: z.iso.date().nullable().optional(),
})

export const LockPlatformWorkspaceFeatureOutputSchema =
    PlatformWorkspaceBillingOutputSchema

export class LockPlatformWorkspaceFeatureFeature {
    constructor(
        readonly workspaceId: string,
        readonly payload: z.infer<typeof LockPlatformWorkspaceFeatureInputSchema>,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type LockPlatformWorkspaceFeatureFeatureResponse = z.infer<
    typeof LockPlatformWorkspaceFeatureOutputSchema
>

// Lifts the lock: the switch stays where it is and is the club's again.
export class UnlockPlatformWorkspaceFeatureFeature {
    constructor(
        readonly workspaceId: string,
        // A path segment, checked against APP_FEATURE_KEYS in the handler.
        readonly feature: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type UnlockPlatformWorkspaceFeatureFeatureResponse = z.infer<
    typeof PlatformWorkspaceBillingOutputSchema
>
