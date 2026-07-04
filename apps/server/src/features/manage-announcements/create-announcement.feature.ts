import { z } from 'zod'

import { AnnouncementOutputSchema } from './schemas'

export const CreateAnnouncementInputSchema = z.object({
    title: z.string().trim().min(1).max(255),
    body: z.string().trim().min(1).max(20000),
    pinned: z.boolean().optional(),
    // Publish immediately, or leave as a staff-only draft.
    publish: z.boolean().optional(),
})
export const CreateAnnouncementOutputSchema = AnnouncementOutputSchema

export class CreateAnnouncementFeature {
    constructor(
        readonly payload: z.infer<typeof CreateAnnouncementInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type CreateAnnouncementFeatureResponse = z.infer<
    typeof CreateAnnouncementOutputSchema
>
