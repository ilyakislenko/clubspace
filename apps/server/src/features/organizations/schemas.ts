import { z } from 'zod'

import type { OrgClubLink } from '../../domains/organizations/club-links'
import type { OrgClubMetrics } from '../../domains/organizations/club-metrics'

// Shared output schemas of the org console (docs/design/2026-11-26-federation-hub-mvp.md §3.2).

export const OrgRoleSchema = z.enum(['ORG_ADMIN', 'ORG_COACH'])
export const OrgTypeSchema = z.enum(['GRAPPLING', 'FITNESS', 'YOGA', 'DANCE', 'CUSTOM'])
export const OrgClubStatusSchema = z.enum(['INVITED', 'ACTIVE', 'DECLINED', 'LEFT', 'REMOVED'])

export const OrganizationOutputSchema = z.object({
    id: z.string().uuid(),
    key: z.string(),
    name: z.string(),
    // Picks the vocabulary only (belts vs. levels).
    type: OrgTypeSchema,
    city: z.string().nullable(),
    description: z.string().nullable(),
    logoKey: z.string().nullable(),
    logoUrl: z.string().nullable(),
    timezone: z.string(),
    isDemo: z.boolean(),
    // The caller's role here (a platform admin acts as ORG_ADMIN).
    myRole: OrgRoleSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})
export type OrganizationOutput = z.infer<typeof OrganizationOutputSchema>

export type OrganizationRow = {
    id: string
    key: string
    name: string
    type: z.infer<typeof OrgTypeSchema>
    city: string | null
    description: string | null
    logoKey: string | null
    timezone: string
    isDemo: boolean
    createdAt: Date
    updatedAt: Date
}

export const ORGANIZATION_SELECT = {
    id: true,
    key: true,
    name: true,
    type: true,
    city: true,
    description: true,
    logoKey: true,
    timezone: true,
    isDemo: true,
    createdAt: true,
    updatedAt: true,
} as const

export const serializeOrganization = (
    org: OrganizationRow,
    p: { myRole: z.infer<typeof OrgRoleSchema>; logoUrl: string | null },
): OrganizationOutput => ({
    id: org.id,
    key: org.key,
    name: org.name,
    type: org.type,
    city: org.city,
    description: org.description,
    logoKey: org.logoKey,
    logoUrl: p.logoUrl,
    timezone: org.timezone,
    isDemo: org.isDemo,
    myRole: p.myRole,
    createdAt: org.createdAt.toISOString(),
    updatedAt: org.updatedAt.toISOString(),
})

const OrgMoneySchema = z.object({
    amount: z.number(),
    currency: z.string().nullable(),
})

const OrgRetentionSchema = z.object({
    // 0..1; null while no newcomer is 3 months old.
    rate: z.number().nullable(),
    eligible: z.number().int(),
})

export const OrgClubMetricsSchema = z.object({
    students: z.number().int(),
    activeStudents: z.number().int(),
    attended30d: z.number().int(),
    new30d: z.number().int(),
    newcomerRetention3m: OrgRetentionSchema,
    // null = the club does not share this figure («не открыт»).
    mrr: OrgMoneySchema.nullable(),
    revenue30d: OrgMoneySchema.nullable(),
})

export const OrgClubSharingSchema = z.object({
    shareRegistry: z.boolean(),
    shareMrr: z.boolean(),
    shareRevenue30d: z.boolean(),
    allowMemberAnnouncements: z.boolean(),
    allowMemberEvents: z.boolean(),
})

export const OrgClubRowSchema = z.object({
    // The link id (OrganizationClub) — the handle for «Исключить».
    id: z.string().uuid(),
    status: OrgClubStatusSchema,
    invitedAt: z.iso.datetime(),
    decidedAt: z.iso.datetime().nullable(),
    club: z.object({
        workspaceId: z.string().uuid(),
        name: z.string(),
        city: z.string().nullable(),
        logoUrl: z.string().nullable(),
        contacts: z.array(z.object({ label: z.string(), phone: z.string() })),
    }),
    sharing: OrgClubSharingSchema,
    // ACTIVE clubs only; null for a pending invitation.
    metrics: OrgClubMetricsSchema.nullable(),
})
export type OrgClubRow = z.infer<typeof OrgClubRowSchema>

export const serializeOrgClubRow = (
    link: OrgClubLink,
    p: { logoUrl: string | null; metrics: OrgClubMetrics | null },
): OrgClubRow => ({
    id: link.id,
    status: link.status,
    invitedAt: link.invitedAt.toISOString(),
    decidedAt: link.decidedAt ? link.decidedAt.toISOString() : null,
    club: {
        workspaceId: link.club.workspaceId,
        name: link.club.name,
        city: link.club.city,
        logoUrl: p.logoUrl,
        contacts: link.club.contacts,
    },
    sharing: {
        shareRegistry: link.shareRegistry,
        shareMrr: link.shareMrr,
        shareRevenue30d: link.shareRevenue30d,
        allowMemberAnnouncements: link.allowMemberAnnouncements,
        allowMemberEvents: link.allowMemberEvents,
    },
    metrics: p.metrics
        ? {
              students: p.metrics.students,
              activeStudents: p.metrics.activeStudents,
              attended30d: p.metrics.attended30d,
              new30d: p.metrics.new30d,
              newcomerRetention3m: p.metrics.newcomerRetention3m,
              mrr: p.metrics.mrr,
              revenue30d: p.metrics.revenue30d,
          }
        : null,
})

const OrgMoneyTotalSchema = OrgMoneySchema.extend({
    // «по N из M клубов».
    clubs: z.number().int(),
})

export const OrgMetricsTotalsSchema = z.object({
    activeClubs: z.number().int(),
    students: z.number().int(),
    activeStudents: z.number().int(),
    attended30d: z.number().int(),
    new30d: z.number().int(),
    newcomerRetention3m: OrgRetentionSchema,
    mrr: OrgMoneyTotalSchema.nullable(),
    revenue30d: OrgMoneyTotalSchema.nullable(),
})

export const OrgMemberOutputSchema = z.object({
    userId: z.string().uuid(),
    name: z.string().nullable(),
    email: z.string().nullable(),
    role: OrgRoleSchema,
    createdAt: z.iso.datetime(),
})
export type OrgMemberOutput = z.infer<typeof OrgMemberOutputSchema>

export const serializeOrgMember = (m: {
    role: z.infer<typeof OrgRoleSchema>
    createdAt: Date
    user: { id: string; email: string | null; firstname: string | null; lastname: string | null }
}): OrgMemberOutput => {
    const name = [m.user.firstname, m.user.lastname].filter(Boolean).join(' ').trim()
    return {
        userId: m.user.id,
        name: name.length > 0 ? name : null,
        email: m.user.email,
        role: m.role,
        createdAt: m.createdAt.toISOString(),
    }
}

export const ORG_MEMBER_SELECT = {
    role: true,
    createdAt: true,
    user: { select: { id: true, email: true, firstname: true, lastname: true } },
} as const

export const SuccessOutputSchema = z.object({ success: z.literal(true) })
