import { z } from 'zod'

import { ClassSubstitutionOutputSchema } from './schemas'

// approve / decline / cancel act on one substitution by id.
export const DecideClassSubstitutionOutputSchema = z.object({
    // The substitution after an approval; null once declined / cancelled
    // (those rows are deleted).
    substitution: ClassSubstitutionOutputSchema.nullable(),
})

class ClassSubstitutionAction {
    constructor(
        readonly workspaceId: string,
        readonly substitutionId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}

export class ApproveClassSubstitutionFeature extends ClassSubstitutionAction {}
export class DeclineClassSubstitutionFeature extends ClassSubstitutionAction {}
export class CancelClassSubstitutionFeature extends ClassSubstitutionAction {}

export type DecideClassSubstitutionFeatureResponse = z.infer<
    typeof DecideClassSubstitutionOutputSchema
>
