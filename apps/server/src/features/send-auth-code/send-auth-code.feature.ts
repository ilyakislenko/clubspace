import { z } from 'zod'
import { LanguageEnum } from '../../infrastructure/prisma'
import { emailSchema } from '../../shared/utils/email'

export const SendAuthCodeFeatureInputSchema = z.object({
    email: emailSchema,
    language: z.enum(LanguageEnum).default(LanguageEnum.EN),
    /**
     * Workspace key of the club the client is built for (e.g. "bjj-academy").
     * Together with `requestJoin` it may file a pending (INVITED) join request
     * there, so the trainer can approve the person without typing e-mails.
     */
    workspaceKey: z.string().min(1).max(50).optional(),
    /**
     * Whether `workspaceKey` should file a join request. `true`: the person
     * explicitly asked to join; `false`: never (the app asks «Вступить в …?»
     * after sign-in instead). Omitted — builds that predate the flag — files it
     * only for a brand-new account, so signing in to a branded app no longer
     * drops a request at that club on every login.
     */
    requestJoin: z.boolean().optional(),
})

// Identical for new and existing accounts (no enumeration).
export const SendAuthCodeFeatureOutputSchema = z.object({
    sent: z.literal(true),
})

export class SendAuthCodeFeature {
    constructor(
        readonly payload: z.infer<typeof SendAuthCodeFeatureInputSchema>,
    ) {}
}

export type SendAuthCodeFeatureResponse = z.infer<
    typeof SendAuthCodeFeatureOutputSchema
>
