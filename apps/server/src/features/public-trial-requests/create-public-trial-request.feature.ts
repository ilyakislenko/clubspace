import { z } from 'zod'

import { leadContactFields, refineLeadContact } from '../leads/schemas'

// POST public/clubs/:slug/trial — «Записаться на пробное». `consent` must be
// true and `consentVersion` the current edition; both are checked in the
// handler after the honeypot, so a bot learns nothing from a 400.
export const CreatePublicTrialRequestInputSchema = z
    .object({
        ...leadContactFields,
        // page = /c/<slug>/trial, qr = the poster (?src=qr).
        source: z.enum(['page', 'qr']),
        consent: z.boolean(),
        consentVersion: z.string().trim().max(64),
        // Honeypot: hidden from people, filled in by form-spamming bots.
        website: z.string().max(500).optional(),
    })
    .superRefine(refineLeadContact)

// Always the same answer: a duplicate or a trap looks like success.
export const CreatePublicTrialRequestOutputSchema = z.object({
    status: z.literal('received'),
})

export class CreatePublicTrialRequestFeature {
    constructor(
        readonly payload: z.infer<typeof CreatePublicTrialRequestInputSchema>,
        readonly slug: string,
        readonly ip: string | null,
        readonly userAgent: string | null,
        readonly now: Date = new Date(),
    ) {}
}
export type CreatePublicTrialRequestFeatureResponse = z.infer<
    typeof CreatePublicTrialRequestOutputSchema
>
