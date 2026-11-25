import { z } from 'zod'

import { strictBoolean } from '../../shared/utils/strict-boolean'
import { ClubMessageRecipientOutputSchema, PagingQueryFields } from './schemas'

export const ListClubMessageRecipientsInputSchema = z.object({
    // true = only who opened it, false = only who didn't.
    read: strictBoolean().optional(),
    ...PagingQueryFields,
})

export const ListClubMessageRecipientsOutputSchema = z.object({
    // Not opened first, then by name.
    data: z.array(ClubMessageRecipientOutputSchema),
    total: z.number().int(),
    curPage: z.number().int(),
    perPage: z.number().int(),
})

export class ListClubMessageRecipientsFeature {
    constructor(
        readonly payload: z.infer<typeof ListClubMessageRecipientsInputSchema>,
        readonly workspaceId: string,
        readonly messageId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListClubMessageRecipientsFeatureResponse = z.infer<
    typeof ListClubMessageRecipientsOutputSchema
>
