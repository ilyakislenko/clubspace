import { z } from 'zod'

import { ExpectedUpdatedAtField } from '../../../shared/utils/optimistic-concurrency'
import { OrganizationAudienceSchema, OrgAnnouncementOutputSchema } from './schemas'

export const UpdateOrgAnnouncementInputSchema = z
    .object({
        title: z.string().trim().min(1).max(255).optional(),
        body: z.string().trim().min(1).max(20000).optional(),
        audience: OrganizationAudienceSchema.optional(),
        // true = publish (keeps an already-live time), false = back to draft.
        publish: z.boolean().optional(),
        publishAt: z.iso.datetime().optional(),
        ...ExpectedUpdatedAtField,
    })
    .refine(
        ({ expectedUpdatedAt: _version, ...fields }) =>
            Object.keys(fields).length > 0,
        { message: 'Нужно заполнить хотя бы одно поле' },
    )
export const UpdateOrgAnnouncementOutputSchema = OrgAnnouncementOutputSchema

export class UpdateOrgAnnouncementFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateOrgAnnouncementInputSchema>,
        readonly organizationId: string,
        readonly announcementId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type UpdateOrgAnnouncementFeatureResponse = z.infer<
    typeof UpdateOrgAnnouncementOutputSchema
>
