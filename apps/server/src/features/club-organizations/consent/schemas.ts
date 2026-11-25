import { z } from 'zod'

import {
    ORG_SHARING_CONSENT_VERSION,
    orgConsentGrantedAt,
    orgSharingConsentText,
} from '../../../domains/organizations/consent'
import { registryLadderIdsFor } from '../../../domains/organizations/registry'
import { PrismaService } from '../../../infrastructure/prisma'

// An organization this club is an ACTIVE member of, as one member (or a
// guardian acting for a child) sees it.
export const MyClubOrganizationOutputSchema = z.object({
    organizationId: z.string().uuid(),
    name: z.string(),
    city: z.string().nullable(),
    // «Показывать мой пояс и записи федерации».
    consentGranted: z.boolean(),
    consentGrantedAt: z.iso.datetime().nullable(),
    // The text shown next to the switch and its edition.
    consentText: z.string(),
    consentVersion: z.string(),
    // The org's registry shows this person's belt from this club right now
    // («В реестре федерации «…»») — the registry's own gates, not a guess.
    visibleInRegistry: z.boolean(),
    // The ladders of this club whose belt the registry shows: «в реестре»
    // goes only under these on «Мои пояса».
    registryLadderIds: z.array(z.string().uuid()),
    // The club lets the org's events into the app.
    eventsEnabled: z.boolean(),
})
export type MyClubOrganizationOutput = z.infer<typeof MyClubOrganizationOutputSchema>

export const serializeMyClubOrganization = (
    o: { id: string; name: string; city: string | null },
    link: { allowMemberEvents: boolean },
    state: { grantedAt: Date | null; registryLadderIds: string[] },
    // A guardian acting for a child reads the child's wording.
    forChild: boolean,
): MyClubOrganizationOutput => ({
    organizationId: o.id,
    name: o.name,
    city: o.city,
    consentGranted: state.grantedAt !== null,
    consentGrantedAt: state.grantedAt?.toISOString() ?? null,
    consentText: orgSharingConsentText(o.name, forChild),
    consentVersion: ORG_SHARING_CONSENT_VERSION,
    visibleInRegistry: state.registryLadderIds.length > 0,
    registryLadderIds: state.registryLadderIds,
    eventsEnabled: link.allowMemberEvents,
})

// The person's consent and registry state for one org of this club, served.
export const loadMyClubOrganization = async (
    prisma: PrismaService,
    link: {
        allowMemberEvents: boolean
        organization: { id: string; name: string; city: string | null }
    },
    p: { workspaceId: string; userId: string; forChild: boolean },
): Promise<MyClubOrganizationOutput> => {
    const organizationId = link.organization.id
    const grantedAt = await orgConsentGrantedAt(prisma, organizationId, p.userId)
    const registryLadderIds = grantedAt
        ? await registryLadderIdsFor(prisma, {
              organizationId,
              workspaceId: p.workspaceId,
              userId: p.userId,
          })
        : []
    return serializeMyClubOrganization(
        link.organization,
        link,
        { grantedAt, registryLadderIds },
        p.forChild,
    )
}

export const ACTIVE_LINK_SELECT = {
    allowMemberEvents: true,
    organization: { select: { id: true, name: true, city: true } },
} as const
