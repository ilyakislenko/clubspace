import { z } from 'zod'

import { GroupRowSchema } from './schemas'

export const ListGroupsFeatureOutputSchema = z.object({
    data: z.array(GroupRowSchema),
    total: z.number().int(),
})

// coachId reaches Prisma as a filter on a @db.Uuid column. Taken as a bare
// string it made any non-uuid value a 500 — an unhandled
// PrismaClientKnownRequestError, reported to Sentry as a server fault, on what
// is plainly a malformed request. Validating it here turns that into the 400 it
// always was, and fixes the contract too: the generated spec marked coachId
// required because a bare @Query() parameter carries no optionality.
export const ListGroupsFeatureInputSchema = z.object({
    coachId: z.string().uuid().optional(),
    // Only groups of this direction.
    directionId: z.string().uuid().optional(),
})

export class ListGroupsFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly invokerRoleName: string | null,
        readonly isSuperAdmin: boolean,
        readonly filters: z.infer<typeof ListGroupsFeatureInputSchema> = {},
    ) {}
}

export type ListGroupsFeatureResponse = z.infer<
    typeof ListGroupsFeatureOutputSchema
>
