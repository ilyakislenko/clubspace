import { z } from 'zod'

import { MyClubMessageOutputSchema, PagingQueryFields } from './schemas'

export const ListMyClubMessagesInputSchema = z.object(PagingQueryFields)

export const ListMyClubMessagesOutputSchema = z.object({
    // Newest first.
    data: z.array(MyClubMessageOutputSchema),
    total: z.number().int(),
    curPage: z.number().int(),
    perPage: z.number().int(),
    // Not opened yet, across pages.
    unreadCount: z.number().int(),
})

export class ListMyClubMessagesFeature {
    constructor(
        readonly payload: z.infer<typeof ListMyClubMessagesInputSchema>,
        readonly workspaceId: string,
        readonly userId: string,
    ) {}
}
export type ListMyClubMessagesFeatureResponse = z.infer<typeof ListMyClubMessagesOutputSchema>
