import { z } from 'zod'

import {
    dateOfBirthSchema,
    dependentNameSchema,
} from './dependents-utils'
import { GuardianRelationSchema, MyDependentOutputSchema } from './schemas'

// The guardian side of families: «Дети» in the member app. Every route acts as
// the signed-in guardian (never under X-Act-As).

export const ListMyDependentsOutputSchema = z.object({
    data: z.array(MyDependentOutputSchema),
})
export class ListMyDependentsFeature {
    constructor(readonly guardianId: string) {}
}
export type ListMyDependentsFeatureResponse = z.infer<
    typeof ListMyDependentsOutputSchema
>

export const AddMyDependentInputSchema = z.object({
    firstname: dependentNameSchema,
    lastname: dependentNameSchema.optional(),
    dateOfBirth: dateOfBirthSchema,
    relation: GuardianRelationSchema.default('PARENT'),
    // The guardian ticks the consent to processing the child's data; the
    // request is refused without it.
    consent: z.literal(true),
})
export class AddMyDependentFeature {
    constructor(
        readonly payload: z.infer<typeof AddMyDependentInputSchema>,
        readonly guardianId: string,
        // Where the consent was given from, kept as evidence.
        readonly ip: string | null = null,
        readonly userAgent: string | null = null,
    ) {}
}
export type AddMyDependentFeatureResponse = z.infer<
    typeof MyDependentOutputSchema
>

export const ConfirmMyDependentInputSchema = z.object({
    relation: GuardianRelationSchema.optional(),
    consent: z.literal(true),
})
export class ConfirmMyDependentFeature {
    constructor(
        readonly payload: z.infer<typeof ConfirmMyDependentInputSchema>,
        readonly guardianId: string,
        readonly dependentId: string,
        readonly ip: string | null = null,
        readonly userAgent: string | null = null,
    ) {}
}
export type ConfirmMyDependentFeatureResponse = z.infer<
    typeof MyDependentOutputSchema
>

export const UpdateMyDependentInputSchema = z
    .object({
        firstname: dependentNameSchema.optional(),
        lastname: dependentNameSchema.nullable().optional(),
        dateOfBirth: dateOfBirthSchema.optional(),
    })
    .refine((p) => Object.values(p).some((v) => v !== undefined), {
        message: 'Нечего сохранять',
    })
export class UpdateMyDependentFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateMyDependentInputSchema>,
        readonly guardianId: string,
        readonly dependentId: string,
    ) {}
}
export type UpdateMyDependentFeatureResponse = z.infer<
    typeof MyDependentOutputSchema
>

export const RemoveMyDependentOutputSchema = z.object({
    status: z.enum(['unlinked', 'deleted']),
})

// Drops the caller's own link: declines a club's pending invitation, or steps
// back while another confirmed guardian stays.
export class UnlinkMyDependentFeature {
    constructor(
        readonly guardianId: string,
        readonly dependentId: string,
    ) {}
}
export type UnlinkMyDependentFeatureResponse = z.infer<
    typeof RemoveMyDependentOutputSchema
>

// Deletes the child's profile everywhere, by the account-deletion rules.
export class DeleteMyDependentFeature {
    constructor(
        readonly guardianId: string,
        readonly dependentId: string,
    ) {}
}
export type DeleteMyDependentFeatureResponse = z.infer<
    typeof RemoveMyDependentOutputSchema
>
