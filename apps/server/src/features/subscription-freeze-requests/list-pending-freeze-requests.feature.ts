import { z } from 'zod'

import { PendingFreezeRequestsOutputSchema } from './schemas'

export const ListPendingFreezeRequestsFeatureOutputSchema =
    PendingFreezeRequestsOutputSchema

export class ListPendingFreezeRequestsFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListPendingFreezeRequestsFeatureResponse = z.infer<
    typeof ListPendingFreezeRequestsFeatureOutputSchema
>
