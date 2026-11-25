import { z } from 'zod'

import { ClubOrgEventOutputSchema } from './schemas'

export const ListClubOrgEventsOutputSchema = z.object({
    data: z.array(ClubOrgEventOutputSchema),
})

export class ListClubOrgEventsFeature {
    constructor(
        readonly workspaceId: string,
        readonly userId: string,
        readonly roleName: string | null,
    ) {}
}
export type ListClubOrgEventsFeatureResponse = z.infer<
    typeof ListClubOrgEventsOutputSchema
>
