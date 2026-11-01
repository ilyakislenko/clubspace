import { z } from 'zod'

export const LeaveWorkspaceFeatureOutputSchema = z.object({
    status: z.literal('left'),
})

export class LeaveWorkspaceFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
    ) {}
}

export type LeaveWorkspaceFeatureResponse = z.infer<
    typeof LeaveWorkspaceFeatureOutputSchema
>
