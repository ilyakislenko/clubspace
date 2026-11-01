import { z } from 'zod'

import { PlatformWorkspaceBillingOutputSchema } from './platform-workspace-billing-view'

export const GetPlatformWorkspaceBillingOutputSchema =
    PlatformWorkspaceBillingOutputSchema

export class GetPlatformWorkspaceBillingFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type GetPlatformWorkspaceBillingFeatureResponse = z.infer<
    typeof GetPlatformWorkspaceBillingOutputSchema
>
