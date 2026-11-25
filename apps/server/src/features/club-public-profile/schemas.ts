import { z } from 'zod'

import { buildJoinUrl } from '../../domains/workspace/invite-links'

export const ClubPublicProfileSchema = z.object({
    // app.<domain>/c/<slug>; generated from the name, editable.
    slug: z.string(),
    city: z.string().nullable(),
    description: z.string().nullable(),
    logoKey: z.string().nullable(),
    // Short-lived signed URL of the logo; null without one.
    logoUrl: z.string().nullable(),
    // Shown in club search and on /c/<slug>. Off by default.
    isListed: z.boolean(),
    // The public club page; null when APP_URL is not configured. Answers 404
    // until the club is listed.
    pageUrl: z.string().nullable(),
    // The join preview (/join/<code>), which works whether listed or not.
    joinPageUrl: z.string().nullable(),
    // «Заявки на пробное с сайта» (docs/design/2026-11-26-leads.md §3.3).
    trialRequestsEnabled: z.boolean(),
    pdOperatorName: z.string().nullable(),
    pdOperatorAddress: z.string().nullable(),
    // /c/<slug>/trial; null without APP_URL. Answers 404 while the form is off.
    trialFormUrl: z.string().nullable(),
    // The club's latest acceptance covers the DPA edition that lists lead
    // subjects; until then the form can't be switched on.
    leadsDpaAccepted: z.boolean(),
    // The club row's version (shared with the settings): a save sends it
    // back as `expectedUpdatedAt`.
    updatedAt: z.iso.datetime(),
})

export type ClubPublicProfileOutput = z.infer<typeof ClubPublicProfileSchema>

export const serializeClubPublicProfile = (p: {
    slug: string
    joinCode: string
    appUrl: string | null
    workspace: {
        city: string | null
        publicDescription: string | null
        logoKey: string | null
        isListed: boolean
        trialRequestsEnabled: boolean
        pdOperatorName: string | null
        pdOperatorAddress: string | null
        updatedAt: Date
    }
    logoUrl: string | null
    leadsDpaAccepted: boolean
}): ClubPublicProfileOutput => ({
    slug: p.slug,
    city: p.workspace.city,
    description: p.workspace.publicDescription,
    logoKey: p.workspace.logoKey,
    logoUrl: p.logoUrl,
    isListed: p.workspace.isListed,
    pageUrl: p.appUrl ? `${p.appUrl}/c/${p.slug}` : null,
    joinPageUrl: buildJoinUrl(p.appUrl, p.joinCode),
    trialRequestsEnabled: p.workspace.trialRequestsEnabled,
    pdOperatorName: p.workspace.pdOperatorName,
    pdOperatorAddress: p.workspace.pdOperatorAddress,
    trialFormUrl: p.appUrl ? `${p.appUrl}/c/${p.slug}/trial` : null,
    leadsDpaAccepted: p.leadsDpaAccepted,
    updatedAt: p.workspace.updatedAt.toISOString(),
})

export const PUBLIC_PROFILE_WORKSPACE_SELECT = {
    id: true,
    name: true,
    city: true,
    publicDescription: true,
    logoKey: true,
    isListed: true,
    trialRequestsEnabled: true,
    pdOperatorName: true,
    pdOperatorAddress: true,
    updatedAt: true,
} as const
