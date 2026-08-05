import { z } from 'zod'

export const GetMeFeatureOutputSchema = z.object({
    id: z.string().uuid(),
    email: z.string(),
    firstname: z.string().nullable().optional(),
    lastname: z.string().nullable().optional(),
    profilePhotoUrl: z.string().nullable().optional(),
    language: z.string(),
    // Platform-console flag. The admin app has no other way to learn that the
    // signed-in account may see /platform — workspace membership says nothing
    // about platform power, and a super admin typically has no memberships at
    // all. Read from the DB, never from the client.
    isSuperAdmin: z.boolean(),
    createdAt: z.iso.datetime(),
})

export class GetMeFeature {
    constructor(readonly userId: string) {}
}

export type GetMeFeatureResponse = z.infer<typeof GetMeFeatureOutputSchema>
