import { z } from 'zod'

import { DeletedOutputSchema } from './schemas'

export const DeleteGroupExceptionFeatureOutputSchema = DeletedOutputSchema

export class DeleteGroupExceptionFeature {
    constructor(
        readonly workspaceId: string,
        readonly groupId: string,
        readonly exceptionId: string,
        readonly invokerUserId: string,
        readonly invokerRoleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type DeleteGroupExceptionFeatureResponse = z.infer<
    typeof DeleteGroupExceptionFeatureOutputSchema
>
