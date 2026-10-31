import { z } from 'zod'

// The consent kinds a user can be asked for. Mirrors the ConsentKind enum.
export const ConsentKindSchema = z.enum(['PERSONAL_DATA'])

export const MyConsentOutputSchema = z.object({
    kind: ConsentKindSchema,
    // The edition the client must show and send back on accept.
    currentVersion: z.string(),
    acceptedVersion: z.string().nullable(),
    // When the accepted edition was accepted; null when never accepted.
    acceptedAt: z.iso.datetime().nullable(),
    // true while the API refuses everything but the consent screen's routes.
    required: z.boolean(),
})
export type MyConsentOutput = z.infer<typeof MyConsentOutputSchema>

// The latest still-standing acceptance of the user's accepted edition.
export const consentStatusSelect = (kind: 'PERSONAL_DATA') =>
    ({
        personalDataConsentVersion: true,
        consentRecords: {
            where: { kind, withdrawnAt: null },
            orderBy: { acceptedAt: 'desc' },
            take: 1,
            select: { version: true, acceptedAt: true },
        },
    }) as const

export const serializeMyConsent = (
    user: {
        personalDataConsentVersion: string | null
        consentRecords: { version: string; acceptedAt: Date }[]
    },
    currentVersion: string,
): MyConsentOutput => {
    const accepted = user.personalDataConsentVersion
    const record = user.consentRecords.find((r) => r.version === accepted)
    return {
        kind: 'PERSONAL_DATA',
        currentVersion,
        acceptedVersion: accepted,
        acceptedAt: record ? record.acceptedAt.toISOString() : null,
        required: accepted !== currentVersion,
    }
}
