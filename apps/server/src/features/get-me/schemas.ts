import { z } from 'zod'

export const MeOutputSchema = z.object({
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
export type MeOutput = z.infer<typeof MeOutputSchema>

// Shared by GET /me and PATCH /me so both answer with exactly the same shape.
export const ME_SELECT = {
    id: true,
    email: true,
    firstname: true,
    lastname: true,
    profilePhotoUrl: true,
    language: true,
    isSuperAdmin: true,
    createdAt: true,
} as const

export const serializeMe = (user: {
    id: string
    email: string
    firstname: string | null
    lastname: string | null
    profilePhotoUrl: string | null
    language: string
    isSuperAdmin: boolean
    createdAt: Date
}): MeOutput => ({
    id: user.id,
    email: user.email,
    firstname: user.firstname,
    lastname: user.lastname,
    profilePhotoUrl: user.profilePhotoUrl,
    language: user.language,
    isSuperAdmin: user.isSuperAdmin,
    createdAt: user.createdAt.toISOString(),
})
