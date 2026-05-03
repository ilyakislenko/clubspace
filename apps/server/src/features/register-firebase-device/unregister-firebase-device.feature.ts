import { z } from 'zod'

export const UnregisterFirebaseDeviceFeatureInputSchema = z.object({
    token: z.string().min(8).max(2048),
})

export const UnregisterFirebaseDeviceFeatureOutputSchema = z.object({
    status: z.literal('removed'),
})

export class UnregisterFirebaseDeviceFeature {
    constructor(
        readonly userId: string,
        readonly token: string,
    ) {}
}

export type UnregisterFirebaseDeviceFeatureResponse = z.infer<
    typeof UnregisterFirebaseDeviceFeatureOutputSchema
>
