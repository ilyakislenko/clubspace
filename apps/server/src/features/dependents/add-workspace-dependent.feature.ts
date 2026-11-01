import { z } from 'zod'

import { emailSchema } from '../../shared/utils/email'
import { dateOfBirthSchema, dependentNameSchema } from './dependents-utils'
import { GuardianRelationSchema } from './schemas'

// «Добавить ребёнка» on the club's member screen: the child joins the club
// at once (optionally into a group); the named guardian confirms in the app.
export const AddWorkspaceDependentInputSchema = z.object({
    firstname: dependentNameSchema,
    lastname: dependentNameSchema.optional(),
    dateOfBirth: dateOfBirthSchema,
    guardianEmail: emailSchema,
    relation: GuardianRelationSchema.default('PARENT'),
    groupId: z.string().uuid().optional(),
    sendEmail: z.boolean().default(true),
})

export const AddWorkspaceDependentOutputSchema = z.object({
    dependentId: z.string().uuid(),
    membershipId: z.string().uuid(),
    guardianUserId: z.string().uuid(),
    // true when the e-mail had no account yet and one was created for it.
    guardianIsNew: z.boolean(),
    emailSent: z.boolean(),
    groupId: z.string().uuid().nullable(),
})

export class AddWorkspaceDependentFeature {
    constructor(
        readonly payload: z.infer<typeof AddWorkspaceDependentInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export type AddWorkspaceDependentFeatureResponse = z.infer<
    typeof AddWorkspaceDependentOutputSchema
>
