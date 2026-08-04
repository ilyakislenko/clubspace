import { z } from 'zod'

// Shared output shapes for the platform console (`/platform/*`), the layer
// that sits above the per-workspace admin. Everything here is deliberately
// sport-agnostic: the console lists and creates clubs of any WorkspaceType.

export const WorkspaceTypeSchema = z.enum([
    'GRAPPLING',
    'FITNESS',
    'YOGA',
    'CUSTOM',
])

export const PlatformWorkspaceOwnerSchema = z.object({
    userId: z.string().uuid(),
    email: z.string(),
    firstname: z.string().nullable(),
    lastname: z.string().nullable(),
})

export const PlatformWorkspaceSchema = z.object({
    workspaceId: z.string().uuid(),
    key: z.string(),
    name: z.string(),
    type: z.string(),
    isActive: z.boolean(),
    timezone: z.string(),
    // Nullable because ownerId is a plain column, not a foreign key — a
    // workspace whose owner row was deleted must still list, not 500.
    owner: PlatformWorkspaceOwnerSchema.nullable(),
    memberCount: z.number().int(),
    createdAt: z.iso.datetime(),
})

export type PlatformWorkspace = z.infer<typeof PlatformWorkspaceSchema>

type WorkspaceRow = {
    id: string
    key: string
    name: string
    type: string
    isActive: boolean
    timezone: string
    createdAt: Date
    _count?: { members: number }
}

type OwnerRow = {
    id: string
    email: string
    firstname: string | null
    lastname: string | null
}

export const serializePlatformWorkspace = (
    workspace: WorkspaceRow,
    owner: OwnerRow | null,
    memberCount?: number,
): PlatformWorkspace => ({
    workspaceId: workspace.id,
    key: workspace.key,
    name: workspace.name,
    type: workspace.type,
    isActive: workspace.isActive,
    timezone: workspace.timezone,
    owner: owner
        ? {
              userId: owner.id,
              email: owner.email,
              firstname: owner.firstname,
              lastname: owner.lastname,
          }
        : null,
    memberCount: memberCount ?? workspace._count?.members ?? 0,
    createdAt: workspace.createdAt.toISOString(),
})
