import { z } from 'zod'

import {
    DiscountFieldsSchema,
    DiscountOutputSchema,
    discountShapeIssue,
    shapeOfInput,
} from './schemas'

// Flat + superRefine (no discriminated union, conventions §1).
export const CreateDiscountInputSchema = DiscountFieldsSchema.superRefine((p, ctx) => {
    const issue = discountShapeIssue(shapeOfInput(p))
    if (issue) ctx.addIssue({ code: 'custom', message: issue })
})
export const CreateDiscountOutputSchema = DiscountOutputSchema

export class CreateDiscountFeature {
    constructor(
        readonly payload: z.infer<typeof CreateDiscountInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type CreateDiscountFeatureResponse = z.infer<typeof CreateDiscountOutputSchema>
