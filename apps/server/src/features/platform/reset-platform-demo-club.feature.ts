import { z } from 'zod'

import { DEMO_CLUB_IDS, type DemoClubId } from '../../domains/demo/demo-clubs'

export const ResetPlatformDemoClubOutputSchema = z.object({
    club: z.enum(DEMO_CLUB_IDS),
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
        readonly club: DemoClubId,
    ) {}
}

export type ResetPlatformDemoClubFeatureResponse = z.infer<
    typeof ResetPlatformDemoClubOutputSchema
>
