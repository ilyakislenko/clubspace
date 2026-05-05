import { z } from 'zod'

export const DeleteGroupFeatureOutputSchema = z.object({
    status: z.literal('deleted'),
})

export class DeleteGroupFeature {
    constructor(
        readonly workspaceId: string,
        readonly groupId: string,
        readonly invokerUserId: string,
        readonly invokerRoleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type DeleteGroupFeatureResponse = z.infer<
    typeof DeleteGroupFeatureOutputSchema
>
