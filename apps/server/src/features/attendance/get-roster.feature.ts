import { z } from 'zod'

import { SessionRosterOutputSchema } from './schemas'

export const GetSessionRosterOutputSchema = SessionRosterOutputSchema

export class GetSessionRosterFeature {
    constructor(
        readonly workspaceId: string,
        readonly sessionId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type GetSessionRosterFeatureResponse = z.infer<
    typeof GetSessionRosterOutputSchema
>
