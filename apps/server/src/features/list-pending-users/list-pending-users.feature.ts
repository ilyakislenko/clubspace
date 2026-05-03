import { z } from 'zod'

export const ListPendingUsersFeatureOutputSchema = z.object({
    data: z.array(
        z.object({
            userId: z.string().uuid(),
            email: z.string(),
            firstname: z.string().nullable().optional(),
            lastname: z.string().nullable().optional(),
            createdAt: z.iso.datetime(),
            lastSeenAt: z.iso.datetime(),
        }),
    ),
    total: z.number().int(),
})

export class ListPendingUsersFeature {
    constructor(readonly workspaceId: string) {}
}

export type ListPendingUsersFeatureResponse = z.infer<
    typeof ListPendingUsersFeatureOutputSchema
>
