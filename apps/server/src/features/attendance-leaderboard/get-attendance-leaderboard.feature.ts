import { z } from 'zod'

export const LeaderboardPeriodSchema = z.enum(['week', 'month'])
export type LeaderboardPeriod = z.infer<typeof LeaderboardPeriodSchema>

export const GetAttendanceLeaderboardInputSchema = z.object({
    period: LeaderboardPeriodSchema.optional(),
})

const LeaderboardEntrySchema = z.object({
    userId: z.string().uuid(),
    name: z.string(),
    checkins: z.number().int(),
    rank: z.number().int(),
    isMe: z.boolean(),
})

// The caller's own line, shown even when they've opted out (their own data is
// always theirs to see); `rank` is null when they're unranked (opted out or no
// check-ins in the period).
const LeaderboardMeSchema = z.object({
    checkins: z.number().int(),
    rank: z.number().int().nullable(),
    streakWeeks: z.number().int(),
    hidden: z.boolean(),
})

export const GetAttendanceLeaderboardOutputSchema = z.object({
    // False when the club owner turned the whole board off — the client then
    // hides the feature entirely.
    enabled: z.boolean(),
    period: LeaderboardPeriodSchema,
    entries: z.array(LeaderboardEntrySchema),
    me: LeaderboardMeSchema,
})

export class GetAttendanceLeaderboardFeature {
    constructor(
        readonly workspaceId: string,
        readonly userId: string,
        readonly payload: z.infer<typeof GetAttendanceLeaderboardInputSchema>,
    ) {}
}

export type GetAttendanceLeaderboardFeatureResponse = z.infer<
    typeof GetAttendanceLeaderboardOutputSchema
>
