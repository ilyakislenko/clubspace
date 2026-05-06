import { z } from 'zod'

export const DeleteVideoSubtitleFeatureOutputSchema = z.object({
    status: z.literal('deleted'),
})

export class DeleteVideoSubtitleFeature {
    constructor(
        readonly workspaceId: string,
        readonly videoId: string,
        readonly subtitleId: string,
    ) {}
}

export type DeleteVideoSubtitleFeatureResponse = z.infer<
    typeof DeleteVideoSubtitleFeatureOutputSchema
>
