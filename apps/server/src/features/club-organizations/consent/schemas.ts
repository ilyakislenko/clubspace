import { z } from 'zod'

import {
    hasOrgConsent,
    ORG_SHARING_CONSENT_VERSION,
    orgConsentGrantedAt,
    orgSharingConsentText,
} from '../../../domains/organizations/consent'
import { registryLadderIdsFor } from '../../../domains/organizations/registry'
import { personPodiums } from '../../../domains/tournaments/tournament-read'
import { PrismaService } from '../../../infrastructure/prisma'

export const MyTournamentPodiumSchema = z.object({
    eventId: z.string().uuid(),
    tournamentTitle: z.string(),
    // The event's local date.
    date: z.iso.date(),
    divisionName: z.string(),
    place: z.number().int(),
})
export type MyTournamentPodium = z.infer<typeof MyTournamentPodiumSchema>

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
    // The live consent is at the current edition (covers tournaments,
    // docs/design/2026-11-27-tournaments.md §2.4); false with consentGranted
    // = «обновите согласие».
    consentCurrent: z.boolean(),
    // The person's published podiums in this org's tournaments («Мои пояса»:
    // «2 место — Кубок федерации, 1-й этап · 12 окт»). Own data: shown
    // regardless of the current consent.
    podiums: z.array(MyTournamentPodiumSchema),
})
export type MyClubOrganizationOutput = z.infer<typeof MyClubOrganizationOutputSchema>

export const serializeMyClubOrganization = (
    o: { id: string; name: string; city: string | null },
    link: { allowMemberEvents: boolean },
    state: {
        grantedAt: Date | null
        consentCurrent: boolean
        registryLadderIds: string[]
        podiums: MyTournamentPodium[]
    },
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
    consentCurrent: state.consentCurrent,
    podiums: state.podiums,
})

// The person's consent, registry state and published podiums for one org of
// this club, served.
export const loadMyClubOrganization = async (
    prisma: PrismaService,
    link: {
        allowMemberEvents: boolean
        organization: { id: string; name: string; city: string | null }
    },
    p: { workspaceId: string; userId: string; forChild: boolean },
): Promise<MyClubOrganizationOutput> => {
    const organizationId = link.organization.id
    const [grantedAt, podiums] = await Promise.all([
        orgConsentGrantedAt(prisma, organizationId, p.userId),
        personPodiums(prisma, organizationId, [p.userId]),
    ])
    const [registryLadderIds, consentCurrent] = grantedAt
        ? await Promise.all([
              registryLadderIdsFor(prisma, {
                  organizationId,
                  workspaceId: p.workspaceId,
                  userId: p.userId,
              }),
              hasOrgConsent(prisma, organizationId, p.userId, {
                  minVersion: ORG_SHARING_CONSENT_VERSION,
              }),
          ])
        : [[], false]
    return serializeMyClubOrganization(
        link.organization,
        link,
        {
            grantedAt,
            consentCurrent,
            registryLadderIds,
            podiums: podiums.map(({ userId: _u, ...rest }) => rest),
        },
        p.forChild,
    )
}

export const ACTIVE_LINK_SELECT = {
    allowMemberEvents: true,
    organization: { select: { id: true, name: true, city: true } },
} as const
