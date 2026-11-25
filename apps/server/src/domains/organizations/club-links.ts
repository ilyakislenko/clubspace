// The allow-listed reader of club rows for the org side
// (docs/design/2026-11-26-federation-hub-mvp.md §1 «What a club shares»):
// name, city, logo and public contacts — part of membership — and nothing
// else. features/organizations/** never selects club tables itself
// (data-source.spec.ts).
import { z } from 'zod'

import { ClubAboutContactSchema } from '../../features/club-about/schemas'
import type { Prisma, PrismaService } from '../../infrastructure/prisma'
import { normalizeJoinCode } from '../workspace/join-code'

export type OrgClubCard = {
    workspaceId: string
    name: string
    city: string | null
    logoKey: string | null
    contacts: Array<{ label: string; phone: string }>
}

const ContactsColumn = z.array(ClubAboutContactSchema).catch([])

const CLUB_CARD_SELECT = {
    id: true,
    name: true,
    city: true,
    logoKey: true,
    aboutContacts: true,
} as const satisfies Prisma.WorkspaceSelect

const toCard = (w: {
    id: string
    name: string
    city: string | null
    logoKey: string | null
    aboutContacts: unknown
}): OrgClubCard => ({
    workspaceId: w.id,
    name: w.name,
    city: w.city,
    logoKey: w.logoKey,
    contacts: ContactsColumn.parse(w.aboutContacts),
})

// The invite lookup — the same rule as `GET public/clubs/by-code/:code`:
// malformed, unknown and deactivated codes are all «not found».
export const findClubByJoinCode = async (
    prisma: Pick<PrismaService, 'workspaceJoinCode'>,
    rawCode: string,
): Promise<(OrgClubCard & { ownerId: string; isDemo: boolean }) | null> => {
    const code = normalizeJoinCode(rawCode)
    if (!code) return null
    const row = await prisma.workspaceJoinCode.findUnique({
        where: { code },
        select: {
            workspace: {
                select: { ...CLUB_CARD_SELECT, ownerId: true, isActive: true, isDemo: true },
            },
        },
    })
    const ws = row?.workspace
    if (!ws || !ws.isActive) return null
    return { ...toCard(ws), ownerId: ws.ownerId, isDemo: ws.isDemo }
}

export type OrgClubLink = {
    id: string
    status: 'INVITED' | 'ACTIVE' | 'DECLINED' | 'LEFT' | 'REMOVED'
    invitedAt: Date
    decidedAt: Date | null
    shareRegistry: boolean
    shareMrr: boolean
    shareRevenue30d: boolean
    allowMemberAnnouncements: boolean
    allowMemberEvents: boolean
    club: OrgClubCard
}

const LINK_SELECT = {
    id: true,
    status: true,
    invitedAt: true,
    decidedAt: true,
    shareRegistry: true,
    shareMrr: true,
    shareRevenue30d: true,
    allowMemberAnnouncements: true,
    allowMemberEvents: true,
    workspace: { select: CLUB_CARD_SELECT },
} as const satisfies Prisma.OrganizationClubSelect

type LinkRow = Omit<OrgClubLink, 'club'> & {
    workspace: Parameters<typeof toCard>[0]
}

const toLink = ({ workspace, ...link }: LinkRow): OrgClubLink => ({
    ...link,
    club: toCard(workspace),
})

// The console's «Клубы»: active members and pending invitations (a declined,
// departed or removed club is history, not a row).
export const loadOrgClubLinks = async (
    prisma: Pick<PrismaService, 'organizationClub'>,
    organizationId: string,
): Promise<OrgClubLink[]> =>
    (
        await prisma.organizationClub.findMany({
            where: { organizationId, status: { in: ['INVITED', 'ACTIVE'] } },
            select: LINK_SELECT,
            // Enum order: ACTIVE before INVITED when descending.
            orderBy: [{ status: 'desc' }, { invitedAt: 'asc' }],
        })
    ).map(toLink)

export const loadOrgClubLink = async (
    prisma: Pick<PrismaService, 'organizationClub'>,
    organizationId: string,
    linkId: string,
): Promise<OrgClubLink | null> => {
    const row = await prisma.organizationClub.findFirst({
        where: { id: linkId, organizationId },
        select: LINK_SELECT,
    })
    return row ? toLink(row) : null
}
