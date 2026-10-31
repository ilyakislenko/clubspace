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
    }
    logoUrl: string | null
}): ClubPublicProfileOutput => ({
    slug: p.slug,
    city: p.workspace.city,
    description: p.workspace.publicDescription,
    logoKey: p.workspace.logoKey,
    logoUrl: p.logoUrl,
    isListed: p.workspace.isListed,
    pageUrl: p.appUrl ? `${p.appUrl}/c/${p.slug}` : null,
    joinPageUrl: buildJoinUrl(p.appUrl, p.joinCode),
})

export const PUBLIC_PROFILE_WORKSPACE_SELECT = {
    id: true,
    name: true,
    city: true,
    publicDescription: true,
    logoKey: true,
    isListed: true,
} as const
