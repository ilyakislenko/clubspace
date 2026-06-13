import { z } from 'zod'

export const SignOutFeatureInputSchema = z.object({
    refreshToken: z.string().nonempty(),
})

export const SignOutFeatureOutputSchema = z.object({
    status: z.literal('signed-out'),
})

export class SignOutFeature {
    constructor(
        readonly payload: z.infer<typeof SignOutFeatureInputSchema>,
    ) {}
}

export type SignOutFeatureResponse = z.infer<typeof SignOutFeatureOutputSchema>
