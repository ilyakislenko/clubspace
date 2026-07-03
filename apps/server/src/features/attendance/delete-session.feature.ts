import { z } from 'zod'

import { DeletedOutputSchema } from './schemas'

export const DeleteSessionOutputSchema = DeletedOutputSchema

export class DeleteSessionFeature {
    constructor(
        readonly workspaceId: string,
        readonly sessionId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type DeleteSessionFeatureResponse = z.infer<
    typeof DeleteSessionOutputSchema
>
