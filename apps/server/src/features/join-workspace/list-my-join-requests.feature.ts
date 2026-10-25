import { z } from 'zod'

export const ListMyJoinRequestsFeatureOutputSchema = z.object({
    data: z.array(
        z.object({
            workspaceId: z.string().uuid(),
            workspaceName: z.string(),
            // The white-label app filters by its own key (the key already
            // ships inside that app).
            workspaceKey: z.string(),
            status: z.enum(['pending', 'rejected']),
            requestedAt: z.iso.datetime(),
        }),
    ),
})

export class ListMyJoinRequestsFeature {
    constructor(readonly invokerUserId: string) {}
}

export type ListMyJoinRequestsFeatureResponse = z.infer<
    typeof ListMyJoinRequestsFeatureOutputSchema
>
