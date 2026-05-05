import { z } from 'zod'

const GroupRowSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    scheduleText: z.string().nullable(),
    gym: z.object({
        id: z.string().uuid(),
        name: z.string(),
        address: z.string(),
    }),
    coach: z.object({
        id: z.string().uuid(),
        email: z.string(),
        firstname: z.string().nullable(),
        lastname: z.string().nullable(),
    }),
    memberCount: z.number().int(),
    createdAt: z.iso.datetime(),
})

export const ListGroupsFeatureOutputSchema = z.object({
    data: z.array(GroupRowSchema),
    total: z.number().int(),
})

export class ListGroupsFeature {
    constructor(
        readonly workspaceId: string,
        readonly filters: { coachId?: string } = {},
    ) {}
}

export type ListGroupsFeatureResponse = z.infer<
    typeof ListGroupsFeatureOutputSchema
>
