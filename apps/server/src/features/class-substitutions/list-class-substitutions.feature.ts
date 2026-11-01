import { z } from 'zod'

import { ClassSubstitutionOutputSchema } from './schemas'

export const ListClassSubstitutionsInputSchema = z.object({
    from: z.iso.date(),
    to: z.iso.date(),
})
export const ListClassSubstitutionsOutputSchema = z.object({
    data: z.array(ClassSubstitutionOutputSchema),
})

// Substitutions of the period the viewer is part of: all of them for a club
// admin; for a coach the ones they run, asked for, or that touch the groups
// they run (own groups, managed directions).
export class ListClassSubstitutionsFeature {
    constructor(
        readonly payload: z.infer<typeof ListClassSubstitutionsInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListClassSubstitutionsFeatureResponse = z.infer<
    typeof ListClassSubstitutionsOutputSchema
>

// Coaches who can stand in: the «Назначить замену» picker.
export const ListSubstituteCandidatesOutputSchema = z.object({
    data: z.array(
        z.object({
            id: z.string().uuid(),
            email: z.string().nullable(),
            firstname: z.string().nullable(),
            lastname: z.string().nullable(),
        }),
    ),
})

export class ListSubstituteCandidatesFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListSubstituteCandidatesFeatureResponse = z.infer<
    typeof ListSubstituteCandidatesOutputSchema
>
