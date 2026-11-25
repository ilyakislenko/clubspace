import { z } from 'zod'

import { MyClubOrganizationOutputSchema } from './schemas'

export const ListMyClubOrganizationsOutputSchema = z.object({
    data: z.array(MyClubOrganizationOutputSchema),
})

export class ListMyClubOrganizationsFeature {
    constructor(
        readonly workspaceId: string,
        // The person (a child when a guardian acts for it).
        readonly userId: string,
        // The guardian acting for the child (X-Act-As), else null.
        readonly guardianId: string | null,
    ) {}
}
export type ListMyClubOrganizationsFeatureResponse = z.infer<
    typeof ListMyClubOrganizationsOutputSchema
>
