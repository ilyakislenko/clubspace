import { z } from 'zod'

const RecentEventSchema = z.object({
    id: z.string().uuid(),
    action: z.string(),
    targetType: z.string(),
    targetId: z.string().nullable(),
    actorEmail: z.string().nullable(),
    createdAt: z.iso.datetime(),
})

export const GetWorkspaceStatsFeatureOutputSchema = z.object({
    counts: z.object({
        videos: z.number().int(),
        videosReady: z.number().int(),
        courses: z.number().int(),
        members: z.number().int(),
    }),
    recentEvents: z.array(RecentEventSchema),
})

export class GetWorkspaceStatsFeature {
    constructor(readonly workspaceId: string) {}
}

export type GetWorkspaceStatsFeatureResponse = z.infer<
    typeof GetWorkspaceStatsFeatureOutputSchema
>
