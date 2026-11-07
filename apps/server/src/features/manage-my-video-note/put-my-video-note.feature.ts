import { z } from 'zod'

import { MyVideoNoteSchema } from './schemas'

export const PutMyVideoNoteFeatureInputSchema = z.object({
    // Empty text clears the note (stored as a tombstone, still LWW-checked).
    text: z.string().max(20000),
    // Client clock of the edit — last-write-wins key for offline sync.
    updatedAt: z.iso.datetime(),
})

export const PutMyVideoNoteFeatureOutputSchema = MyVideoNoteSchema

export class PutMyVideoNoteFeature {
    constructor(
        readonly userId: string,
        readonly videoId: string,
        readonly payload: z.infer<typeof PutMyVideoNoteFeatureInputSchema>,
    ) {}
}

export type PutMyVideoNoteFeatureResponse = z.infer<
    typeof PutMyVideoNoteFeatureOutputSchema
>
