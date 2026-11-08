import { z } from 'zod'

export const SignOutFeatureInputSchema = z.object({
    // Omitted by a cookie-transport client: the token comes from the cookie.
    refreshToken: z.string().nonempty().optional(),
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
