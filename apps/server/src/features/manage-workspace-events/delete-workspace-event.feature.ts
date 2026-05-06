import { z } from 'zod'

import { DeletedOutputSchema } from './schemas'

export const DeleteWorkspaceEventFeatureOutputSchema = DeletedOutputSchema

export class DeleteWorkspaceEventFeature {
    constructor(
        readonly workspaceId: string,
        readonly eventId: string,
        readonly invokerUserId: string,
    ) {}
}

export type DeleteWorkspaceEventFeatureResponse = z.infer<
    typeof DeleteWorkspaceEventFeatureOutputSchema
>
