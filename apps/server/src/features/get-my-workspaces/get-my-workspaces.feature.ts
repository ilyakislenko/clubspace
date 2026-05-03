import { z } from 'zod'

import { CurrentUserPayload } from '../../shared/decorators/current-user.decorator'

export const GetMyWorkspacesFeatureInputSchema = z.object({
    curPage: z.number().int().optional(),
    perPage: z.number().int().optional(),
})

export const GetMyWorkspacesFeatureOutputSchema = z.object({
    data: z.array(
        z.object({
            workspaceId: z.string(),
            key: z.string(),
            name: z.string(),
            type: z.string(),
            isActive: z.boolean(),
            accessUntil: z.iso.datetime().nullable(),
            accessExpired: z.boolean(),
        }),
    ),
    meta: z.object({
        curPage: z.number().int(),
        perPage: z.number().int(),
        total: z.number().int(),
    }),
})

export class GetMyWorkspacesFeature {
    constructor(
        readonly payload: z.infer<typeof GetMyWorkspacesFeatureInputSchema>,
        readonly user: CurrentUserPayload,
    ) {}
}

export type GetMyWorkspacesFeatureResponse = z.infer<
    typeof GetMyWorkspacesFeatureOutputSchema
>
