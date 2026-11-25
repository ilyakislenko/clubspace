import { z } from 'zod'

// GET leads/trial-link — the QR poster «Пробное занятие». `missing` names
// what stops the public form: the switch (or the DPA it waits for), the
// operator's name and address, or the app address (no APP_URL).
export const TrialLinkOutputSchema = z.object({
    // /c/<slug>/trial?src=qr — the poster's link; null without APP_URL.
    url: z.string().nullable(),
    // PNG data URI of the QR; null while `missing` is set.
    qrPngDataUrl: z.string().nullable(),
    missing: z.enum(['disabled', 'slug', 'operator']).nullable(),
})

export class GetTrialLinkFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type GetTrialLinkFeatureResponse = z.infer<typeof TrialLinkOutputSchema>
