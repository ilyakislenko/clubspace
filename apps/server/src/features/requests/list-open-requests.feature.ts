import { z } from 'zod'

import { OpenRequestSchema, RequestCountsSchema, RequestKindSchema } from './schemas'

export const OPEN_REQUESTS_DEFAULT_PER_PAGE = 50
export const OPEN_REQUESTS_MAX_PER_PAGE = 100

export const ListOpenRequestsInputSchema = z.object({
    kind: RequestKindSchema.optional(),
    curPage: z.coerce.number().int().positive().optional(),
    perPage: z.coerce.number().int().positive().max(OPEN_REQUESTS_MAX_PER_PAGE).optional(),
})

export const ListOpenRequestsOutputSchema = z.object({
    // Oldest first (waited longest), of `kind` when given.
    data: z.array(OpenRequestSchema),
    // Rows of the view (the kind filter applied) across all pages.
    total: z.number().int(),
    curPage: z.number().int(),
    perPage: z.number().int(),
    // Every kind in the viewer's scope, whatever the filter; 0 for a kind
    // that doesn't apply. «Сегодня» and the tab badge read these.
    counts: RequestCountsSchema,
    // The kinds this viewer may get in this club, in display order.
    kinds: z.array(RequestKindSchema),
})

export class ListOpenRequestsFeature {
    constructor(
        readonly payload: z.infer<typeof ListOpenRequestsInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListOpenRequestsFeatureResponse = z.infer<typeof ListOpenRequestsOutputSchema>
