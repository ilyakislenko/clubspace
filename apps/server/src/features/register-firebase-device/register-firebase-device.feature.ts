import { z } from 'zod'

export const RegisterFirebaseDeviceFeatureInputSchema = z.object({
    token: z.string().min(8).max(2048),
    timezone: z.string().min(1).max(64).default('UTC'),
})

export const RegisterFirebaseDeviceFeatureOutputSchema = z.object({
    status: z.literal('registered'),
})

export class RegisterFirebaseDeviceFeature {
    constructor(
        readonly userId: string,
        readonly payload: z.infer<
            typeof RegisterFirebaseDeviceFeatureInputSchema
        >,
    ) {}
}

export type RegisterFirebaseDeviceFeatureResponse = z.infer<
    typeof RegisterFirebaseDeviceFeatureOutputSchema
>
