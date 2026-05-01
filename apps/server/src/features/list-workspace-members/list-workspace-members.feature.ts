import { z } from 'zod'

export const ListWorkspaceMembersFeatureOutputSchema = z.object({
    data: z.array(
        z.object({
            id: z.string().uuid(),
            userId: z.string().uuid(),
            email: z.string(),
            firstname: z.string().nullable().optional(),
            lastname: z.string().nullable().optional(),
            status: z.string(),
            roleName: z.string(),
            isOwner: z.boolean(),
            createdAt: z.iso.datetime(),
        }),
    ),
    total: z.number().int(),
})

export class ListWorkspaceMembersFeature {
    constructor(readonly workspaceId: string) {}
}

export type ListWorkspaceMembersFeatureResponse = z.infer<
    typeof ListWorkspaceMembersFeatureOutputSchema
>
