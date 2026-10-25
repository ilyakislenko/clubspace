import { z } from 'zod'

import { formatJoinCode } from '../../domains/workspace/join-code'
import { buildAppLinks, buildJoinUrl } from '../../domains/workspace/invite-links'

export const WorkspaceInviteSchema = z.object({
    workspaceId: z.string().uuid(),
    workspaceName: z.string(),
    // "ABCD2345"
    joinCode: z.string(),
    // "ABCD-2345"
    joinCodeDisplay: z.string(),
    // `${APP_URL}/join/ABCD2345`
    joinUrl: z.string(),
    // data:image/png;base64,… — never log it.
    qrPngDataUrl: z.string(),
    joinAutoApprove: z.boolean(),
    appLinks: z.object({
        web: z.string(),
        googlePlay: z.string().nullable(),
        ruStore: z.string().nullable(),
    }),
})

export type WorkspaceInviteOutput = z.infer<typeof WorkspaceInviteSchema>

export const serializeWorkspaceInvite = (
    ws: { id: string; name: string; joinAutoApprove: boolean },
    code: string,
    qrPngDataUrl: string,
    urls: { appUrl: string; playStoreUrl?: string; ruStoreUrl?: string },
): WorkspaceInviteOutput => ({
    workspaceId: ws.id,
    workspaceName: ws.name,
    joinCode: code,
    joinCodeDisplay: formatJoinCode(code),
    joinUrl: buildJoinUrl(urls.appUrl, code),
    qrPngDataUrl,
    joinAutoApprove: ws.joinAutoApprove,
    appLinks: buildAppLinks(urls),
})
