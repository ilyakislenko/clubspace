import { z } from 'zod'

import {
    OrgClubSharingSchema,
    OrgClubStatusSchema,
    OrgTypeSchema,
} from '../organizations/schemas'

// «Настройки → Федерация» (docs/design/2026-11-26-federation-hub-mvp.md §3.3, §4.2).

// A partial sharing change: only the toggles sent are written.
export const OrgSharingPatchSchema = z.object({
    shareRegistry: z.boolean().optional(),
    shareMrr: z.boolean().optional(),
    shareRevenue30d: z.boolean().optional(),
    allowMemberAnnouncements: z.boolean().optional(),
    allowMemberEvents: z.boolean().optional(),
})
export type OrgSharingPatch = z.infer<typeof OrgSharingPatchSchema>

export const ClubOrganizationLinkSchema = z.object({
    // The link id — the handle for accept / decline / sharing / leave.
    id: z.string().uuid(),
    status: OrgClubStatusSchema,
    invitedAt: z.iso.datetime(),
    decidedAt: z.iso.datetime().nullable(),
    organization: z.object({
        id: z.string().uuid(),
        name: z.string(),
        type: OrgTypeSchema,
        city: z.string().nullable(),
        description: z.string().nullable(),
        logoUrl: z.string().nullable(),
    }),
    sharing: OrgClubSharingSchema,
    // Only the club owner (or the platform) may accept an invitation.
    canAccept: z.boolean(),
})
export type ClubOrganizationLink = z.infer<typeof ClubOrganizationLinkSchema>

export const CLUB_ORG_LINK_SELECT = {
    id: true,
    status: true,
    invitedAt: true,
    decidedAt: true,
    shareRegistry: true,
    shareMrr: true,
    shareRevenue30d: true,
    allowMemberAnnouncements: true,
    allowMemberEvents: true,
    organization: {
        select: { id: true, name: true, type: true, city: true, description: true, logoKey: true },
    },
} as const

export type ClubOrgLinkRow = {
    id: string
    status: z.infer<typeof OrgClubStatusSchema>
    invitedAt: Date
    decidedAt: Date | null
    shareRegistry: boolean
    shareMrr: boolean
    shareRevenue30d: boolean
    allowMemberAnnouncements: boolean
    allowMemberEvents: boolean
    organization: {
        id: string
        name: string
        type: z.infer<typeof OrgTypeSchema>
        city: string | null
        description: string | null
        logoKey: string | null
    }
}

export const serializeClubOrganizationLink = (
    row: ClubOrgLinkRow,
    p: { logoUrl: string | null; canAccept: boolean },
): ClubOrganizationLink => ({
    id: row.id,
    status: row.status,
    invitedAt: row.invitedAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    organization: {
        id: row.organization.id,
        name: row.organization.name,
        type: row.organization.type,
        city: row.organization.city,
        description: row.organization.description,
        logoUrl: p.logoUrl,
    },
    sharing: {
        shareRegistry: row.shareRegistry,
        shareMrr: row.shareMrr,
        shareRevenue30d: row.shareRevenue30d,
        allowMemberAnnouncements: row.allowMemberAnnouncements,
        allowMemberEvents: row.allowMemberEvents,
    },
    canAccept: p.canAccept,
})

// The toggles a patch actually changes (audit metadata).
export const changedSharing = (
    before: Omit<ClubOrgLinkRow, 'id' | 'status' | 'invitedAt' | 'decidedAt' | 'organization'>,
    patch: OrgSharingPatch,
): OrgSharingPatch =>
    Object.fromEntries(
        (Object.keys(patch) as Array<keyof OrgSharingPatch>)
            .filter((k) => patch[k] !== undefined && patch[k] !== before[k])
            .map((k) => [k, patch[k]]),
    )
