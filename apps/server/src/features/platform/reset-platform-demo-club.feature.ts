import { z } from 'zod'

export const ResetPlatformDemoClubOutputSchema = z.object({
    workspaceId: z.uuid(),
    durationMs: z.number().int(),
    counts: z.object({
        members: z.number().int(),
        groups: z.number().int(),
        sessions: z.number().int(),
        visits: z.number().int(),
        subscriptions: z.number().int(),
    }),
})

export class ResetPlatformDemoClubFeature {
    constructor(
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ResetPlatformDemoClubFeatureResponse = z.infer<
    typeof ResetPlatformDemoClubOutputSchema
>
