import { z } from 'zod'

import { ExpectedUpdatedAtField } from '../../shared/utils/optimistic-concurrency'
import { LEAD_LIMITS, LeadSchema } from './schemas'

// PATCH leads/:leadId — «Изменить данные» and «Заметка». Omitted = unchanged;
// null clears an optional field.
export const UpdateLeadInputSchema = z.object({
    name: z.string().trim().min(1).max(LEAD_LIMITS.name).optional(),
    phone: z.string().trim().min(1).max(LEAD_LIMITS.phone).optional(),
    email: z.string().trim().max(LEAD_LIMITS.email).nullable().optional(),
    forChild: z.boolean().optional(),
    childName: z.string().trim().max(LEAD_LIMITS.childName).nullable().optional(),
    childAge: z
        .number()
        .int()
        .min(LEAD_LIMITS.childAgeMin)
        .max(LEAD_LIMITS.childAgeMax)
        .nullable()
        .optional(),
    directionId: z.string().uuid().nullable().optional(),
    staffNote: z.string().trim().max(LEAD_LIMITS.staffNote).nullable().optional(),
    ...ExpectedUpdatedAtField,
})

export class UpdateLeadFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateLeadInputSchema>,
        readonly workspaceId: string,
        readonly leadId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type UpdateLeadFeatureResponse = z.infer<typeof LeadSchema>
