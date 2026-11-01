import { z } from 'zod'

export const GetPlatformOverviewOutputSchema = z.object({
    workspaceCount: z.number().int(),
    activeWorkspaceCount: z.number().int(),
    // Excludes soft-deleted accounts (deletedAt set) so the number matches
    // "people who can sign in", not rows in the table.
    userCount: z.number().int(),
    activeMembershipCount: z.number().int(),
    platformAdminCount: z.number().int(),
    // Clubs by platform-billing status (clubs with no billing row yet are
    // on the default plan, ACTIVE, and so not in these).
    trialWorkspaceCount: z.number().int(),
    pastDueWorkspaceCount: z.number().int(),
    suspendedWorkspaceCount: z.number().int(),
    // Trial → paid. Every club starts on a trial; `converted` paid a first
    // period (card or the console's «отметить оплату»). Conversion counts
    // only decided trials — ended or converted — so running ones don't drag
    // it down; null until one is decided.
    trials: z.object({
        started: z.number().int(),
        running: z.number().int(),
        converted: z.number().int(),
        conversionPercent: z.number().nullable(),
        // From the trial's start to the first paid period; null with none.
        averageDaysToConvert: z.number().nullable(),
    }),
    // «Помощь с подключением» requests waiting for the platform.
    openOnboardingRequestCount: z.number().int(),
})

export class GetPlatformOverviewFeature {
    constructor(
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type GetPlatformOverviewFeatureResponse = z.infer<
    typeof GetPlatformOverviewOutputSchema
>
