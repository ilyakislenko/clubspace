import { z } from 'zod'

import {
    CLUB_LOGO_CONTENT_TYPES,
    CLUB_LOGO_MAX_BYTES,
} from '../../domains/workspace/club-logo'

// The club logo rules (raster only, 2 MB signed into the URL).
export const CreateOrganizationLogoUploadInputSchema = z.object({
    contentType: z.enum(CLUB_LOGO_CONTENT_TYPES),
    contentLength: z.number().int().positive().max(CLUB_LOGO_MAX_BYTES, {
        message: 'Логотип должен быть не больше 2 МБ',
    }),
})

export const CreateOrganizationLogoUploadOutputSchema = z.object({
    // Pass back as `logoKey` in PATCH orgs/:id.
    key: z.string(),
    upload: z.object({
        url: z.string().url(),
        method: z.literal('PUT'),
    }),
})

export class CreateOrganizationLogoUploadFeature {
    constructor(
        readonly payload: z.infer<typeof CreateOrganizationLogoUploadInputSchema>,
        readonly organizationId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type CreateOrganizationLogoUploadFeatureResponse = z.infer<
    typeof CreateOrganizationLogoUploadOutputSchema
>
