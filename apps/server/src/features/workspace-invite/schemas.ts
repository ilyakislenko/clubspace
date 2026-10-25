import { z } from 'zod'

import { formatJoinCode } from '../../domains/workspace/join-code'
import { buildAppLinks, buildJoinUrl } from '../../domains/workspace/invite-links'
import { PUBLIC_URL_MISSING_NOTICE } from '../../shared/utils/public-urls'

export const WorkspaceInviteSchema = z.object({
    workspaceId: z.string().uuid(),
    workspaceName: z.string(),
    // "ABCD2345"
    joinCode: z.string(),
    // "ABCD-2345"
    joinCodeDisplay: z.string(),
    // `${APP_URL}/join/ABCD2345`; null when APP_URL is not configured.
    joinUrl: z.string().nullable(),
    // data:image/png;base64,… — never log it. Null together with joinUrl.
    qrPngDataUrl: z.string().nullable(),
    // Why joinUrl / qrPngDataUrl are missing; null when they are present.
    publicUrlNotice: z.string().nullable(),
    joinAutoApprove: z.boolean(),
    appLinks: z.object({
        web: z.string().nullable(),
        googlePlay: z.string().nullable(),
        ruStore: z.string().nullable(),
    }),
})

export type WorkspaceInviteOutput = z.infer<typeof WorkspaceInviteSchema>

export const serializeWorkspaceInvite = (
    ws: { id: string; name: string; joinAutoApprove: boolean },
    code: string,
    qrPngDataUrl: string | null,
    urls: { appUrl: string | null; playStoreUrl?: string; ruStoreUrl?: string },
): WorkspaceInviteOutput => ({
    workspaceId: ws.id,
    workspaceName: ws.name,
    joinCode: code,
    joinCodeDisplay: formatJoinCode(code),
    joinUrl: buildJoinUrl(urls.appUrl, code),
    qrPngDataUrl,
    publicUrlNotice: urls.appUrl ? null : PUBLIC_URL_MISSING_NOTICE,
    joinAutoApprove: ws.joinAutoApprove,
    appLinks: buildAppLinks(urls),
})
