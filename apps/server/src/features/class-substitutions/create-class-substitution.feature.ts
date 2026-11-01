import { z } from 'zod'

import { ClassSubstitutionOutputSchema } from './schemas'

export const CreateClassSubstitutionInputSchema = z.object({
    slotId: z.string().uuid(),
    // The club calendar day of the class.
    sessionDate: z.iso.date(),
    // Who runs the class. Omitted (or the caller) = «Взять занятие»: the
    // caller offers to take it, approved at once when they run the group.
    substituteId: z.string().uuid().optional(),
    note: z.string().trim().max(255).optional(),
})
export const CreateClassSubstitutionOutputSchema = ClassSubstitutionOutputSchema

export class CreateClassSubstitutionFeature {
    constructor(
        readonly payload: z.infer<typeof CreateClassSubstitutionInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type CreateClassSubstitutionFeatureResponse = z.infer<
    typeof CreateClassSubstitutionOutputSchema
>
