import { z } from 'zod'

import { JournalEntrySchema } from './schemas'

export const ListJournalInputSchema = z.object({
    curPage: z.coerce.number().int().positive().optional(),
    perPage: z.coerce.number().int().positive().max(100).optional(),
})

export const ListJournalOutputSchema = z.object({
    entries: z.array(JournalEntrySchema),
    total: z.number().int(),
    curPage: z.number().int(),
    perPage: z.number().int(),
})

export class ListJournalFeature {
    constructor(
        readonly payload: z.infer<typeof ListJournalInputSchema>,
        readonly workspaceId: string,
        readonly userId: string,
    ) {}
}

export type ListJournalFeatureResponse = z.infer<
    typeof ListJournalOutputSchema
>
