import { z } from 'zod'

import {
    IanaTimezoneSchema,
    PlatformWorkspaceSchema,
    WorkspaceTypeSchema,
} from './schemas'
import { emailSchema } from '../../shared/utils/email'

export const UpdatePlatformWorkspaceInputSchema = z.object({
    name: z.string().trim().min(1).max(255).optional(),
    // Only the type: the dictionary and the storefront follow it, the club's
    // feature switches (ranks, video, …) stay as they are.
    type: WorkspaceTypeSchema.optional(),
    timezone: IanaTimezoneSchema.optional(),
    // Switches the club off: WorkspaceMemberGuard refuses every club route
    // with WORKSPACE_SUSPENDED (reason INACTIVE) for its members, owner
    // included, regardless of billing. Platform staff still get in.
    isActive: z.boolean().optional(),
    // Hands the club to a different person. The account is created if this
    // address is unknown, exactly as on create.
    ownerEmail: emailSchema.optional(),
})

export const UpdatePlatformWorkspaceOutputSchema = z.object({
    workspace: PlatformWorkspaceSchema,
    ownerCreated: z.boolean(),
    ownerTransferred: z.boolean(),
})

export class UpdatePlatformWorkspaceFeature {
    constructor(
        readonly workspaceId: string,
        readonly payload: z.infer<typeof UpdatePlatformWorkspaceInputSchema>,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type UpdatePlatformWorkspaceFeatureResponse = z.infer<
    typeof UpdatePlatformWorkspaceOutputSchema
>
