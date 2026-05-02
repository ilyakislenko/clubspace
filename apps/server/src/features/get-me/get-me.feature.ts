import { z } from 'zod'

export const GetMeFeatureOutputSchema = z.object({
    id: z.string().uuid(),
    email: z.string(),
    firstname: z.string().nullable().optional(),
    lastname: z.string().nullable().optional(),
    profilePhotoUrl: z.string().nullable().optional(),
    language: z.string(),
    createdAt: z.iso.datetime(),
})

export class GetMeFeature {
    constructor(readonly userId: string) {}
}

export type GetMeFeatureResponse = z.infer<typeof GetMeFeatureOutputSchema>
