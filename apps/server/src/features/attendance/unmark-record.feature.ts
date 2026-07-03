import { z } from 'zod'

import { SessionRosterOutputSchema } from './schemas'

export const UnmarkRecordOutputSchema = SessionRosterOutputSchema

export class UnmarkRecordFeature {
    constructor(
        readonly workspaceId: string,
        readonly sessionId: string,
        readonly userId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type UnmarkRecordFeatureResponse = z.infer<
    typeof UnmarkRecordOutputSchema
>
