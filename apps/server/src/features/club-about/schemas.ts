import { z } from 'zod'

import { isHttpUrl } from '../../shared/utils/http-url'

export const ClubAboutContactSchema = z.object({
    label: z.string(),
    phone: z.string(),
})

export const ClubAboutLinkSchema = z.object({
    label: z.string(),
    url: z.string(),
})

export const ClubAboutOutputSchema = z.object({
    contacts: z.array(ClubAboutContactSchema),
    links: z.array(ClubAboutLinkSchema),
    rules: z.string().nullable(),
    updatedAt: z.iso.datetime().nullable(),
})

export type ClubAboutOutput = z.infer<typeof ClubAboutOutputSchema>

// The Json columns are written only by update-club-about, but a hand-edited or
// legacy value must never turn the student's screen into a 500 — fall back to
// an empty list instead. Links are re-checked on read as well, so a row edited
// by hand cannot hand the app a javascript: URL.
const ContactsColumn = z.array(ClubAboutContactSchema).catch([])
const LinksColumn = z.array(ClubAboutLinkSchema).catch([])

export const serializeClubAbout = (w: {
    aboutContacts: unknown
    aboutLinks: unknown
    aboutRules: string | null
    aboutUpdatedAt: Date | null
}): ClubAboutOutput => ({
    contacts: ContactsColumn.parse(w.aboutContacts),
    links: LinksColumn.parse(w.aboutLinks).filter((l) => isHttpUrl(l.url)),
    rules: w.aboutRules,
    updatedAt: w.aboutUpdatedAt ? w.aboutUpdatedAt.toISOString() : null,
})
