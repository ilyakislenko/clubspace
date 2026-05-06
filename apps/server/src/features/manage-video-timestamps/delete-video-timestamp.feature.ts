import { z } from 'zod'

export const DeleteVideoTimestampFeatureOutputSchema = z.object({
    status: z.literal('deleted'),
})

export class DeleteVideoTimestampFeature {
    constructor(
        readonly workspaceId: string,
        readonly videoId: string,
        readonly timestampId: string,
    ) {}
}

export type DeleteVideoTimestampFeatureResponse = z.infer<
    typeof DeleteVideoTimestampFeatureOutputSchema
>
