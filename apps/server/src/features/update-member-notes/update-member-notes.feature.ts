import { z } from 'zod'

export const UpdateMemberNotesFeatureInputSchema = z.object({
    // null or empty clears the note; capped so it stays a note.
    notes: z.string().max(5000).nullable(),
})

export const UpdateMemberNotesFeatureOutputSchema = z.object({
    userId: z.string().uuid(),
    notes: z.string().nullable(),
})

export class UpdateMemberNotesFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateMemberNotesFeatureInputSchema>,
        readonly workspaceId: string,
        readonly userId: string,
        readonly invokerUserId: string,
    ) {}
}

export type UpdateMemberNotesFeatureResponse = z.infer<
    typeof UpdateMemberNotesFeatureOutputSchema
>
