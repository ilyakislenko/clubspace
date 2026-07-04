import { z } from 'zod'

import { AnnouncementDeletedOutputSchema } from './schemas'

export const DeleteAnnouncementOutputSchema = AnnouncementDeletedOutputSchema

export class DeleteAnnouncementFeature {
    constructor(
        readonly workspaceId: string,
        readonly announcementId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type DeleteAnnouncementFeatureResponse = z.infer<
    typeof DeleteAnnouncementOutputSchema
>
