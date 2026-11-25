import { z } from 'zod'

import { dateOfBirthSchema } from '../dependents/dependents-utils'
import { MeOutputSchema } from '../get-me/schemas'

// A blank field clears the name rather than storing an empty string, so
// "no name" stays one state (null) everywhere names are displayed.
const nameField = z
    .string()
    .trim()
    .max(100)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v))

export const UpdateMeInputSchema = z.object({
    firstname: nameField,
    lastname: nameField,
    // YYYY-MM-DD; null clears it. Club staff see it and the club greets on
    // the day.
    dateOfBirth: dateOfBirthSchema.nullable().optional(),
})
export const UpdateMeOutputSchema = MeOutputSchema

export class UpdateMeFeature {
    constructor(
        readonly payload: z.infer<typeof UpdateMeInputSchema>,
        readonly userId: string,
    ) {}
}
export type UpdateMeFeatureResponse = z.infer<typeof UpdateMeOutputSchema>
