import { z } from 'zod'

import { ClubMessageOutputSchema, ClubMessageStatusSchema, PagingQueryFields } from './schemas'

export const ListClubMessagesInputSchema = z.object({
    // Only messages this student received (the member card's «Сообщения»);
    // each row then carries `recipientReadAt`.
    userId: z.string().uuid().optional(),
    status: ClubMessageStatusSchema.optional(),
    ...PagingQueryFields,
})

export const ListClubMessagesOutputSchema = z.object({
    // Newest first.
    data: z.array(ClubMessageOutputSchema),
    total: z.number().int(),
    curPage: z.number().int(),
    perPage: z.number().int(),
    // The club's zone: «Отправится в 09:00» is club time.
    timezone: z.string(),
})

export class ListClubMessagesFeature {
    constructor(
        readonly payload: z.infer<typeof ListClubMessagesInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListClubMessagesFeatureResponse = z.infer<typeof ListClubMessagesOutputSchema>
