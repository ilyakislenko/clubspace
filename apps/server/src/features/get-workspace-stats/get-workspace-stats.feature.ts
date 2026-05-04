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
    topVideos7d: z.array(TopVideoSchema),
    recentEvents: z.array(RecentEventSchema),
})

export class GetWorkspaceStatsFeature {
    constructor(readonly workspaceId: string) {}
}

export type GetWorkspaceStatsFeatureResponse = z.infer<
    typeof GetWorkspaceStatsFeatureOutputSchema
>
