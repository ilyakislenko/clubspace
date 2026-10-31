import { z } from 'zod'

const InvitedRoleSchema = z.enum(['user', 'coach'])

const toRole = (roleName: string): z.infer<typeof InvitedRoleSchema> =>
    roleName === 'coach' ? 'coach' : 'user'

// What the invited person sees in the app.
export const MyInvitationOutputSchema = z.object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    workspaceName: z.string(),
    workspaceType: z.string(),
    roleName: InvitedRoleSchema,
    groupName: z.string().nullable(),
    invitedAt: z.iso.datetime(),
})

export const serializeMyInvitation = (
    row: {
        id: string
        roleName: string
        createdAt: Date
        workspace: { id: string; name: string; type: string }
    },
    groupName: string | null,
): z.infer<typeof MyInvitationOutputSchema> => ({
    id: row.id,
    workspaceId: row.workspace.id,
    workspaceName: row.workspace.name,
    workspaceType: row.workspace.type,
    roleName: toRole(row.roleName),
    groupName,
    invitedAt: row.createdAt.toISOString(),
})

// What the club's admins see: the address they typed, never the person's
// profile — the account is not in the club until they accept.
export const WorkspaceInvitationOutputSchema = z.object({
    id: z.string().uuid(),
    email: z.string(),
    roleName: InvitedRoleSchema,
    groupId: z.string().uuid().nullable(),
    invitedAt: z.iso.datetime(),
})

export const serializeWorkspaceInvitation = (row: {
    id: string
    roleName: string
    groupId: string | null
    createdAt: Date
    user: { email: string }
}): z.infer<typeof WorkspaceInvitationOutputSchema> => ({
    id: row.id,
    email: row.user.email,
    roleName: toRole(row.roleName),
    groupId: row.groupId,
    invitedAt: row.createdAt.toISOString(),
})
