import { z } from 'zod'

import { MyVideoBookmarkSchema } from './schemas'

export const ListMyVideoBookmarksFeatureOutputSchema = z.object({
    items: z.array(MyVideoBookmarkSchema),
})

export class ListMyVideoBookmarksFeature {
    constructor(
        readonly userId: string,
        readonly videoId: string,
    ) {}
}

export type ListMyVideoBookmarksFeatureResponse = z.infer<
    typeof ListMyVideoBookmarksFeatureOutputSchema
>
