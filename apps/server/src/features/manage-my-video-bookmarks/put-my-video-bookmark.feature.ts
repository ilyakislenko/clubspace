import { z } from 'zod'

import { MyVideoBookmarkSchema } from './schemas'

export const PutMyVideoBookmarkFeatureInputSchema = z.object({
    positionSec: z.number().int().min(0),
    // Must be > positionSec when set (checked in the handler).
    endSec: z.number().int().nullable(),
    label: z.string().max(255),
    note: z.string().max(5000),
    // Client clock of the edit — last-write-wins key for offline sync.
    updatedAt: z.iso.datetime(),
    // true = delete (kept as a tombstone so an older offline edit can't
    // resurrect it); false on a tombstoned id revives it.
    deleted: z.boolean().default(false),
})

export const PutMyVideoBookmarkFeatureOutputSchema = MyVideoBookmarkSchema

export class PutMyVideoBookmarkFeature {
    constructor(
        readonly userId: string,
        readonly videoId: string,
        readonly bookmarkId: string,
        readonly payload: z.infer<typeof PutMyVideoBookmarkFeatureInputSchema>,
    ) {}
}

export type PutMyVideoBookmarkFeatureResponse = z.infer<
    typeof PutMyVideoBookmarkFeatureOutputSchema
>
