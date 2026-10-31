import { z } from 'zod'

import {
    CLUB_LOGO_CONTENT_TYPES,
    CLUB_LOGO_MAX_BYTES,
} from '../../domains/workspace/club-logo'

export const CreateClubLogoUploadFeatureInputSchema = z.object({
    contentType: z.enum(CLUB_LOGO_CONTENT_TYPES),
    // The file's exact size; signed into the URL so storage refuses anything
    // else (and anything over the limit never gets a URL at all).
    contentLength: z.number().int().positive().max(CLUB_LOGO_MAX_BYTES, {
        message: 'Логотип должен быть не больше 2 МБ',
    }),
})

export const CreateClubLogoUploadFeatureOutputSchema = z.object({
    // Pass back as `logoKey` when saving the public profile.
    key: z.string(),
    upload: z.object({
        url: z.string().url(),
        method: z.literal('PUT'),
    }),
})

export class CreateClubLogoUploadFeature {
    constructor(
        readonly payload: z.infer<typeof CreateClubLogoUploadFeatureInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type CreateClubLogoUploadFeatureResponse = z.infer<
    typeof CreateClubLogoUploadFeatureOutputSchema
>
