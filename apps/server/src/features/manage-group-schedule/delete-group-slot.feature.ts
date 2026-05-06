import { z } from 'zod'

import { DeletedOutputSchema } from './schemas'

export const DeleteGroupSlotFeatureOutputSchema = DeletedOutputSchema

export class DeleteGroupSlotFeature {
    constructor(
        readonly workspaceId: string,
        readonly groupId: string,
        readonly slotId: string,
        readonly invokerUserId: string,
        readonly invokerRoleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type DeleteGroupSlotFeatureResponse = z.infer<
    typeof DeleteGroupSlotFeatureOutputSchema
>
