import { z } from 'zod'

import { PlatformWorkspaceSchema, WorkspaceTypeSchema } from './schemas'

export const CreatePlatformWorkspaceInputSchema = z.object({
    name: z.string().trim().min(1).max(255),
    // Optional: derived from the name when omitted. Supplying it matters when
    // the club already hands out a key ("join gracie_barra_msk") that must not
    // change.
    key: z.string().trim().max(50).optional(),
    type: WorkspaceTypeSchema.default('GRAPPLING'),
    // The club is handed to a person, not to the platform admin. If no account
    // exists for this address one is created — sign-in is email-OTP, so a
    // password-less account can log in the moment it exists.
    ownerEmail: z.string().trim().email().max(255),
    timezone: z.string().trim().max(64).optional(),
})

export const CreatePlatformWorkspaceOutputSchema = z.object({
    workspace: PlatformWorkspaceSchema,
    // True when the owner account did not exist and was created by this call —
    // the console shows a different hint ("send them the sign-in link").
    ownerCreated: z.boolean(),
    // True when the welcome e-mail with the sign-in link was handed to the
    // mail transport; false means the operator must pass the address on.
    ownerNotified: z.boolean(),
})

export class CreatePlatformWorkspaceFeature {
    constructor(
        readonly payload: z.infer<typeof CreatePlatformWorkspaceInputSchema>,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type CreatePlatformWorkspaceFeatureResponse = z.infer<
    typeof CreatePlatformWorkspaceOutputSchema
>
