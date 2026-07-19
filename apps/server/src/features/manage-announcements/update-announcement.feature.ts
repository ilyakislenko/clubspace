import { z } from 'zod'

import { AnnouncementOutputSchema } from './schemas'

export const UpdateAnnouncementInputSchema = z
    .object({
        title: z.string().trim().min(1).max(255).optional(),
        body: z.string().trim().min(1).max(20000).optional(),
        pinned: z.boolean().optional(),
        // true = publish (keeps the original publish time if already live),
        // false = revert to draft.
        publish: z.boolean().optional(),
        // Schedule for a specific time (ISO); a future time hides it from the
        // feed until then. Takes precedence over `publish`.
        publishAt: z.iso.datetime().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, {
        message: 'At least one field must be provided',
    })
export const UpdateAnnouncementOutputSchema = AnnouncementOutputSchema

export class UpdateAnnouncementFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateAnnouncementInputSchema>,
        readonly workspaceId: string,
        readonly announcementId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type UpdateAnnouncementFeatureResponse = z.infer<
    typeof UpdateAnnouncementOutputSchema
>
