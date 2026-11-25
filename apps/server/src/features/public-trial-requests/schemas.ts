import { z } from 'zod'

import {
    isValidPublicSlug,
    normalizePublicSlug,
} from '../../domains/workspace/public-slug'
import type { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { ClubAboutContactSchema } from '../club-about/schemas'

export const TRIAL_FORM_CLOSED = 'Клуб не принимает заявки'

// What the trial-request page needs. No ids but the directions' (the form
// sends one back) and no people: the operator is the club's legal entity.
export const PublicTrialFormSchema = z.object({
    clubName: z.string(),
    logoUrl: z.string().nullable(),
    directions: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
    // The operator of the person's data, quoted in the consent text.
    operator: z.object({ name: z.string(), address: z.string() }),
    // The consent edition the page must render and send back.
    consentVersion: z.string(),
    contacts: z.array(ClubAboutContactSchema),
    // A listed club's form may be indexed; an unlisted one is noindex.
    isListed: z.boolean(),
})
export type PublicTrialFormOutput = z.infer<typeof PublicTrialFormSchema>

const trialClubSelect = {
    id: true,
    name: true,
    ownerId: true,
    timezone: true,
    isActive: true,
    isListed: true,
    logoKey: true,
    trialRequestsEnabled: true,
    pdOperatorName: true,
    pdOperatorAddress: true,
    aboutContacts: true,
    aboutLinks: true,
    aboutRules: true,
    aboutUpdatedAt: true,
} as const

// The club behind a public slug, only while it takes requests: active, the
// switch on and the operator named. Listing is not required (a club may take
// requests without appearing in search). Everything else is the same 404.
export const findTrialClub = async (
    prisma: Pick<PrismaService, 'workspacePublicSlug'>,
    rawSlug: string,
) => {
    const slug = normalizePublicSlug(rawSlug)
    const row = isValidPublicSlug(slug)
        ? await prisma.workspacePublicSlug.findUnique({
              where: { slug },
              select: { workspace: { select: trialClubSelect } },
          })
        : null
    const ws = row?.workspace
    if (
        !ws ||
        !ws.isActive ||
        !ws.trialRequestsEnabled ||
        !ws.pdOperatorName ||
        !ws.pdOperatorAddress
    ) {
        throw new NotFoundError({ message: TRIAL_FORM_CLOSED })
    }
    return { ...ws, pdOperatorName: ws.pdOperatorName, pdOperatorAddress: ws.pdOperatorAddress }
}
