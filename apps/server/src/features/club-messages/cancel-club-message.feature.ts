import { z } from 'zod'

import { ClubMessageOutputSchema } from './schemas'

export const CancelClubMessageOutputSchema = ClubMessageOutputSchema

export class CancelClubMessageFeature {
    constructor(
        readonly workspaceId: string,
        readonly messageId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type CancelClubMessageFeatureResponse = z.infer<typeof CancelClubMessageOutputSchema>
