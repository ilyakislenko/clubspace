import { z } from 'zod'

import { ClubMessageOutputSchema, ComposeFields, refineTarget } from './schemas'

export const SendClubMessageInputSchema = z
    .object({
        ...ComposeFields,
        title: z.string().trim().min(1).max(120),
        body: z.string().trim().min(1).max(2000),
        // Written from «Кому позвонить»: a direct message to a member on the
        // sender's open call list also logs «Связались».
        logContact: z.boolean().optional(),
    })
    .superRefine(refineTarget)
export const SendClubMessageOutputSchema = ClubMessageOutputSchema

export class SendClubMessageFeature {
    constructor(
        readonly payload: z.infer<typeof SendClubMessageInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type SendClubMessageFeatureResponse = z.infer<typeof SendClubMessageOutputSchema>
