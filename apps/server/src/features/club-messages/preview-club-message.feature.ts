import { z } from 'zod'

import { ComposeFields, refineTarget } from './schemas'

export const PreviewClubMessageInputSchema = z.object(ComposeFields).superRefine(refineTarget)

// The compose panel's line under the form: how many get it «сейчас» (the
// segment is resolved again at send time), how, and when.
export const PreviewClubMessageOutputSchema = z.object({
    // Students; children counted among them.
    recipients: z.number().int(),
    // Of them, children whose guardians get it.
    children: z.number().int(),
    // Push rows that would be written.
    withPush: z.number().int(),
    // Switched off «Сообщения клуба» (broadcasts only).
    optedOut: z.number().int(),
    // Muted the club (broadcasts only).
    muted: z.number().int(),
    // No app on any device (own, or a child's guardians'): in-app and inbox only.
    noDevice: z.number().int(),
    // Already got today's broadcast pushes from the club (in-app only).
    capped: z.number().int(),
    // Would get the e-mail copy (0 unless the club's e-mail switch is on).
    withEmail: z.number().int(),
    // The club's «Сообщения ученикам на e-mail» switch: compose offers the
    // e-mail checkbox only when on.
    emailEnabled: z.boolean(),
    // E-mails left in the trial allowance; null = not limited.
    emailAllowance: z.number().int().nullable(),
    sendAt: z.iso.datetime(),
    // Moved to 09:00 by quiet hours.
    deferredByQuietHours: z.boolean(),
    // The club's zone (staff below club admin can't read settings).
    timezone: z.string(),
    limits: z.object({
        clubLeft: z.number().int(),
        // null = no personal broadcast limit (sport leads).
        senderLeft: z.number().int().nullable(),
        directLeft: z.number().int(),
        urgentLeft: z.number().int(),
    }),
})

export class PreviewClubMessageFeature {
    constructor(
        readonly payload: z.infer<typeof PreviewClubMessageInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type PreviewClubMessageFeatureResponse = z.infer<typeof PreviewClubMessageOutputSchema>
