import { z } from 'zod'

import { environment } from '../../environments/environment'
import { displayName } from '../attendance/schemas'
import { buildCheckInCardPngDataUrl } from './check-in-card-qr'
import { signCheckInCard } from './check-in-card-utils'

// The member's own card: the string the QR carries, the QR itself and the
// holder's name for the card face.
export const CheckInCardSchema = z.object({
    card: z.string(),
    qrPngDataUrl: z.string(),
    name: z.string(),
})
export type CheckInCardOutput = z.infer<typeof CheckInCardSchema>

// What a scan resolved to, before the app marks the visit through the
// existing records endpoint. inGroup: null for a session with no group (an
// event or a personal session).
export const CheckInCardLookupSchema = z.object({
    userId: z.string().uuid(),
    name: z.string(),
    photoUrl: z.string().nullable(),
    isDependent: z.boolean(),
    inGroup: z.boolean().nullable(),
    alreadyMarked: z.boolean(),
})
export type CheckInCardLookupOutput = z.infer<typeof CheckInCardLookupSchema>

export const CARD_HOLDER_SELECT = {
    id: true,
    firstname: true,
    lastname: true,
    email: true,
} as const

export const serializeCheckInCard = async (user: {
    id: string
    firstname: string | null
    lastname: string | null
    email: string | null
}): Promise<CheckInCardOutput> => {
    const card = signCheckInCard(user.id, environment.encryptionKey)
    return {
        card,
        qrPngDataUrl: await buildCheckInCardPngDataUrl(card),
        name: displayName(user),
    }
}
