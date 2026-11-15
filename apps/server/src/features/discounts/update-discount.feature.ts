import { z } from 'zod'

import { ExpectedUpdatedAtField } from '../../shared/utils/optimistic-concurrency'
import { DiscountFieldsSchema, DiscountOutputSchema } from './schemas'

// The create fields, each optional, plus the archive switch. The rules
// spanning fields run on the merged row in the handler. Edits never touch
// past sales: they keep their snapshot.
export const UpdateDiscountInputSchema = DiscountFieldsSchema.partial()
    .extend({
        // false = archive (no longer selectable, its code stops working);
        // true = restore (re-runs the name and family checks).
        isActive: z.boolean().optional(),
        ...ExpectedUpdatedAtField,
    })
    .refine(
        ({ expectedUpdatedAt: _version, ...fields }) => Object.keys(fields).length > 0,
        { message: 'Нужно заполнить хотя бы одно поле' },
    )
export const UpdateDiscountOutputSchema = DiscountOutputSchema

export class UpdateDiscountFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateDiscountInputSchema>,
        readonly workspaceId: string,
        readonly discountId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type UpdateDiscountFeatureResponse = z.infer<typeof UpdateDiscountOutputSchema>
