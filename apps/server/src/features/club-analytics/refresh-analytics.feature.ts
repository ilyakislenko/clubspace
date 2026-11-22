import { z } from 'zod'

export const RefreshAnalyticsOutputSchema = z.object({
    // fresh = both snapshots are younger than ANALYTICS_FRESH_MS, nothing was
    // started (HTTP 200); queued = a rebuild waits or runs (HTTP 202), the
    // realtime «analytics» invalidation follows when it is done.
    status: z.enum(['fresh', 'queued']),
    historyComputedAt: z.iso.datetime().nullable(),
    riskComputedAt: z.iso.datetime().nullable(),
})

// «Пересчитать сейчас»: rebuilds the club's snapshots outside the schedule
// (after an import, or to show fresh numbers in a meeting).
export class RefreshAnalyticsFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type RefreshAnalyticsFeatureResponse = z.infer<typeof RefreshAnalyticsOutputSchema>
