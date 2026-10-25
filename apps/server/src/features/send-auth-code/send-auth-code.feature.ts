import { z } from 'zod'
import { LanguageEnum } from '../../infrastructure/prisma'
import { emailSchema } from '../../shared/utils/email'

export const SendAuthCodeFeatureInputSchema = z.object({
    email: emailSchema,
    language: z.enum(LanguageEnum).default(LanguageEnum.EN),
    /**
     * Workspace key the client wants to join (e.g. "bjj-academy"). When set
     * and the user is new (or has no membership in that workspace), they are
     * auto-added as INVITED so the trainer can approve them from admin
     * without typing emails by hand.
     */
    workspaceKey: z.string().min(1).max(50).optional(),
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
