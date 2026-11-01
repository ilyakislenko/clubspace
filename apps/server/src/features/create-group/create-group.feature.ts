import { z } from 'zod'

export const CreateGroupFeatureInputSchema = z.object({
    name: z.string().trim().min(1).max(255),
    gymId: z.string().uuid(),
    coachId: z.string().uuid(),
    // Discipline of the group (БЖЖ, ММА…); null/absent = club-wide.
    directionId: z.string().uuid().nullish(),
    memberIds: z.array(z.string().uuid()).optional(),
})

export const CreateGroupFeatureOutputSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    gymId: z.string().uuid().nullable(),
    coachId: z.string().uuid(),
    directionId: z.string().uuid().nullable(),
})

export class CreateGroupFeature {
    constructor(
        readonly payload: z.infer<typeof CreateGroupFeatureInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly invokerRoleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type CreateGroupFeatureResponse = z.infer<
    typeof CreateGroupFeatureOutputSchema
>
