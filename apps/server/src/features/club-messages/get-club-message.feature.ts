import { z } from 'zod'

import { ClubMessageOutputSchema } from './schemas'

export const GetClubMessageOutputSchema = ClubMessageOutputSchema

export class GetClubMessageFeature {
    constructor(
        readonly workspaceId: string,
        readonly messageId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type GetClubMessageFeatureResponse = z.infer<typeof GetClubMessageOutputSchema>
