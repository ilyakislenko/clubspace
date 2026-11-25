import { z } from 'zod'

import { OrganizationAudienceSchema, OrgAnnouncementOutputSchema } from './schemas'

export const CreateOrgAnnouncementInputSchema = z.object({
    title: z.string().trim().min(1).max(255),
    body: z.string().trim().min(1).max(20000),
    audience: OrganizationAudienceSchema.optional(),
    // Publish immediately, or keep as a draft of the federation team.
    publish: z.boolean().optional(),
    // Schedule (ISO); takes precedence over `publish`.
    publishAt: z.iso.datetime().optional(),
})
export const CreateOrgAnnouncementOutputSchema = OrgAnnouncementOutputSchema

export class CreateOrgAnnouncementFeature {
    constructor(
        readonly payload: z.infer<typeof CreateOrgAnnouncementInputSchema>,
        readonly organizationId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type CreateOrgAnnouncementFeatureResponse = z.infer<
    typeof CreateOrgAnnouncementOutputSchema
>
