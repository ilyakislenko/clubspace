import { z } from 'zod'

const RecentEventSchema = z.object({
    id: z.string().uuid(),
    action: z.string(),
    targetType: z.string(),
    targetId: z.string().nullable(),
    actorEmail: z.string().nullable(),
    createdAt: z.iso.datetime(),
})

const TopVideoSchema = z.object({
    id: z.string().uuid(),
    title: z.string(),
    viewers: z.number().int(),
    completions: z.number().int(),
})

// Owner-only money view. Null for coach_own_only invokers — a scoped coach
// never sees club revenue. Amounts are in the subscription's own integer unit
// (same as elsewhere); `currency` is the dominant currency across the rows the
// figure was summed over, so mixed-currency clubs get one coherent number.
const RevenueSchema = z.object({
    activeSubscriptions: z.number().int(),
    revenue30d: z.number().int(),
    // Estimated monthly-recurring: each active time-boxed subscription
    // normalised to a 30-day month. Open-ended subscriptions contribute 0.
    mrr: z.number().int(),
    currency: z.string().nullable(),
    // Revenue per calendar month for the last 6 months (oldest first, current
    // month last); every month present, dominant-currency only.
    trend: z.array(
        z.object({
            month: z.string(), // "YYYY-MM"
            revenue: z.number().int(),
        }),
    ),
    // Sales in the trailing 30 days grouped by tariff, highest revenue first.
    byPlan: z.array(
        z.object({
            planId: z.string().uuid(),
            planName: z.string(),
            count: z.number().int(),
            revenue: z.number().int(),
        }),
    ),
})

export const GetWorkspaceStatsFeatureOutputSchema = z.object({
    counts: z.object({
        videos: z.number().int(),
        videosReady: z.number().int(),
        courses: z.number().int(),
        members: z.number().int(),
    }),
    activity: z.object({
        // Distinct viewers active in the last 7/30 days. Treat the workspace
        // owner as a member so the percentage on the dashboard matches the
        // member count card.
        activeMembers7d: z.number().int(),
        activeMembers30d: z.number().int(),
        completions7d: z.number().int(),
    }),
    attendance: z.object({
        sessions7d: z.number().int(),
        sessions30d: z.number().int(),
        checkins7d: z.number().int(),
        checkins30d: z.number().int(),
        distinctAttendees30d: z.number().int(),
    }),
    retention: z.object({
        // ACTIVE members with no check-in in the last 30 days — the churn
        // watch-list (includes never-attended members).
        inactiveMembers30d: z.number().int(),
        // Access already lapsed vs. lapsing within 14 days.
        expiredAccess: z.number().int(),
        expiringSoon: z.number().int(),
    }),
    revenue: RevenueSchema.nullable(),
    topVideos7d: z.array(TopVideoSchema),
    recentEvents: z.array(RecentEventSchema),
})

export class GetWorkspaceStatsFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly invokerRoleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type GetWorkspaceStatsFeatureResponse = z.infer<
    typeof GetWorkspaceStatsFeatureOutputSchema
>
