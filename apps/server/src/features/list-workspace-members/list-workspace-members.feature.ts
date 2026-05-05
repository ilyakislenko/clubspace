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
            accessUntil: z.iso.datetime().nullable(),
            createdAt: z.iso.datetime(),
            watchedCount: z.number().int(),
            inProgressCount: z.number().int(),
            lastWatchedAt: z.iso.datetime().nullable(),
            lastWatchedVideo: z
                .object({
                    id: z.string().uuid(),
                    title: z.string(),
                })
                .nullable(),
        }),
    ),
    total: z.number().int(),
    workspaceVideoTotal: z.number().int(),
})

export class ListWorkspaceMembersFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly invokerRoleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListWorkspaceMembersFeatureResponse = z.infer<
    typeof ListWorkspaceMembersFeatureOutputSchema
>
