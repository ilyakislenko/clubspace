import { z } from 'zod'

import { JournalEntrySchema } from './schemas'

export const CreateJournalEntryInputSchema = z.object({
    body: z.string().trim().min(1).max(5000),
    // The training day this entry is about; defaults to today (UTC).
    entryDate: z.iso.date().optional(),
})

export const CreateJournalEntryOutputSchema = JournalEntrySchema

export class CreateJournalEntryFeature {
    constructor(
        readonly payload: z.infer<typeof CreateJournalEntryInputSchema>,
        readonly workspaceId: string,
        readonly userId: string,
    ) {}
}

export type CreateJournalEntryFeatureResponse = z.infer<
    typeof CreateJournalEntryOutputSchema
>
