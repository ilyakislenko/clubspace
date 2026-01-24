import { z } from 'zod'
import { LanguageEnum } from '../../infrastructure/prisma'

export const SendAuthCodeFeatureInputSchema = z.object({
    email: z.string().email(),
    language: z.enum(LanguageEnum).default(LanguageEnum.EN),
})

export const SendAuthCodeFeatureOutputSchema = z.object({
    new: z.boolean(),
})

export class SendAuthCodeFeature {
    constructor(
        readonly payload: z.infer<typeof SendAuthCodeFeatureInputSchema>,
    ) {}
}

export type SendAuthCodeFeatureResponse = z.infer<
    typeof SendAuthCodeFeatureOutputSchema
>
