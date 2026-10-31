import { z } from 'zod'

import {
    isValidPublicSlug,
    normalizePublicSlug,
} from '../../domains/workspace/public-slug'
import { ClubPublicProfileSchema } from './schemas'

// Empty text means "not set": stored as null so the public page simply leaves
// the block out.
const optionalText = (max: number) =>
    z
        .string()
        .trim()
        .max(max)
        .nullable()
        .transform((v) => (v ? v : null))

export const UpdateClubPublicProfileFeatureInputSchema = z.object({
    slug: z
        .string()
        .max(64)
        .transform(normalizePublicSlug)
        .refine(isValidPublicSlug, {
            message:
                'Адрес: 3–64 символа — строчные латинские буквы и цифры, слова через дефис',
        }),
    city: optionalText(120),
    description: optionalText(2000),
    // A key returned by the logo-upload endpoint, or null to remove the logo.
    logoKey: z.string().max(255).nullable(),
    isListed: z.boolean(),
})

export const UpdateClubPublicProfileFeatureOutputSchema = ClubPublicProfileSchema

export class UpdateClubPublicProfileFeature {
    constructor(
        readonly payload: z.infer<
            typeof UpdateClubPublicProfileFeatureInputSchema
        >,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type UpdateClubPublicProfileFeatureResponse = z.infer<
    typeof UpdateClubPublicProfileFeatureOutputSchema
>
