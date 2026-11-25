import { z } from 'zod'

import { emailSchema } from '../../shared/utils/email'
import { IanaTimezoneSchema, WorkspaceTypeSchema } from './schemas'

// Creating an organization (federation, network) is a platform action in the
// MVP (docs/design/2026-11-26-federation-hub-mvp.md §3.2): the console names
// its first admin, who then invites clubs and the team.
export const CreatePlatformOrganizationInputSchema = z.object({
    name: z.string().trim().min(1).max(255),
    // Derived from the name when omitted.
    key: z.string().trim().max(50).optional(),
    // Vocabulary only (belts vs. levels).
    type: WorkspaceTypeSchema.default('CUSTOM'),
    city: z.string().trim().max(120).optional(),
    timezone: IanaTimezoneSchema.optional(),
    // The first ORG_ADMIN; an account is created when missing (e-mail OTP).
    adminEmail: emailSchema,
})

export const PlatformOrganizationSchema = z.object({
    id: z.string().uuid(),
    key: z.string(),
    name: z.string(),
    type: WorkspaceTypeSchema,
    city: z.string().nullable(),
    timezone: z.string(),
    isDemo: z.boolean(),
    isActive: z.boolean(),
    activeClubs: z.number().int(),
    invitedClubs: z.number().int(),
    members: z.number().int(),
    createdAt: z.iso.datetime(),
})
export type PlatformOrganization = z.infer<typeof PlatformOrganizationSchema>

export const CreatePlatformOrganizationOutputSchema = z.object({
    organization: PlatformOrganizationSchema,
    // The admin account did not exist and was created by this call.
    adminCreated: z.boolean(),
    // The «Вас добавили в команду федерации» e-mail was handed to the mail transport.
    adminNotified: z.boolean(),
})

export class CreatePlatformOrganizationFeature {
    constructor(
        readonly payload: z.infer<typeof CreatePlatformOrganizationInputSchema>,
        readonly invokerUserId: string,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type CreatePlatformOrganizationFeatureResponse = z.infer<
    typeof CreatePlatformOrganizationOutputSchema
>
