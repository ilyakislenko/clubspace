import { z } from 'zod'

import { PlatformWorkspaceSchema, WorkspaceTypeSchema } from './schemas'
import { emailSchema } from '../../shared/utils/email'

export const UpdatePlatformWorkspaceInputSchema = z.object({
    name: z.string().trim().min(1).max(255).optional(),
    type: WorkspaceTypeSchema.optional(),
    timezone: z.string().trim().max(64).optional(),
    // Flags the club as inactive. Today this is a marker the clients can show —
    // nothing on the server refuses a request because of it. Do not describe it
    // to users as "suspend access" until that is actually enforced (which needs
    // a member-facing "club suspended" screen in the mobile app first).
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
