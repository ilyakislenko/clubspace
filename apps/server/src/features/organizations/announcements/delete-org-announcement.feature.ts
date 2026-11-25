import { z } from 'zod'

import { OrgAnnouncementDeletedOutputSchema } from './schemas'

export const DeleteOrgAnnouncementOutputSchema = OrgAnnouncementDeletedOutputSchema

export class DeleteOrgAnnouncementFeature {
    constructor(
        readonly organizationId: string,
        readonly announcementId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type DeleteOrgAnnouncementFeatureResponse = z.infer<
    typeof DeleteOrgAnnouncementOutputSchema
>
