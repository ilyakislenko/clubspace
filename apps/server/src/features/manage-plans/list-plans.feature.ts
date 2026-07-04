import { z } from 'zod'

import { PlanOutputSchema } from './schemas'

export const ListPlansInputSchema = z.object({
    // Include archived tariffs (isActive=false). Off by default so the
    // assignment pick-list only shows sellable tariffs.
    includeInactive: z.coerce.boolean().optional(),
})
export const ListPlansOutputSchema = z.object({
    data: z.array(PlanOutputSchema),
})

export class ListPlansFeature {
    constructor(
        readonly payload: z.infer<typeof ListPlansInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListPlansFeatureResponse = z.infer<typeof ListPlansOutputSchema>
