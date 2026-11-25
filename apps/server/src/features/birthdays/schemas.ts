import { z } from 'zod'

// A member whose birthday is today, for staff. `turns` only for a child:
// coaches of kids' groups congratulate in class; adults' ages stay off the
// screen.
export const BirthdayMemberSchema = z.object({
    userId: z.string().uuid(),
    name: z.string(),
    photoUrl: z.string().nullable(),
    isDependent: z.boolean(),
    turns: z.number().int().nullable(),
    groups: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
})
export type BirthdayMemberOutput = z.infer<typeof BirthdayMemberSchema>
