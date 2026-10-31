import { z } from 'zod'

export const SignOutEverywhereFeatureOutputSchema = z.object({
    status: z.literal('signed-out'),
})

export class SignOutEverywhereFeature {
    constructor(readonly userId: string) {}
}

export type SignOutEverywhereFeatureResponse = z.infer<
    typeof SignOutEverywhereFeatureOutputSchema
>
