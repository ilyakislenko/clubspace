import { z } from 'zod'

import { BirthdayMemberSchema } from './schemas'

export const ListBirthdaysTodayOutputSchema = z.object({
    // The club-local date the list is for.
    date: z.iso.date(),
    members: z.array(BirthdayMemberSchema),
})

export class ListBirthdaysTodayFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type ListBirthdaysTodayFeatureResponse = z.infer<
    typeof ListBirthdaysTodayOutputSchema
>
