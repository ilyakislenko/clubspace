import { z } from 'zod'

const MyGroupSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    role: z.enum(['coach', 'student']),
    scheduleText: z.string().nullable(),
    gym: z
        .object({
            id: z.string().uuid(),
            name: z.string(),
            address: z.string(),
        })
        .nullable(),
    coach: z.object({
        id: z.string().uuid(),
        firstname: z.string().nullable(),
        lastname: z.string().nullable(),
        email: z.string(),
    }),
    memberCount: z.number().int(),
})

export const GetMyGroupsFeatureOutputSchema = z.object({
    data: z.array(MyGroupSchema),
})

export class GetMyGroupsFeature {
    constructor(
        readonly workspaceId: string,
        readonly userId: string,
    ) {}
}

export type GetMyGroupsFeatureResponse = z.infer<
    typeof GetMyGroupsFeatureOutputSchema
>
