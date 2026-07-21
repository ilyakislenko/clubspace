import { z } from 'zod'

export const DeleteJournalEntryOutputSchema = z.object({
    status: z.literal('deleted'),
})

export class DeleteJournalEntryFeature {
    constructor(
        readonly workspaceId: string,
        readonly userId: string,
        readonly entryId: string,
    ) {}
}

export type DeleteJournalEntryFeatureResponse = z.infer<
    typeof DeleteJournalEntryOutputSchema
>
