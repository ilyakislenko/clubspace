import { z } from 'zod'

import { MyInvitationOutputSchema } from './schemas'

export const ListMyInvitationsOutputSchema = z.object({
    data: z.array(MyInvitationOutputSchema),
})

export class ListMyInvitationsFeature {
    constructor(readonly invokerUserId: string) {}
}

export type ListMyInvitationsFeatureResponse = z.infer<
    typeof ListMyInvitationsOutputSchema
>
