import { z } from 'zod'

// Руководители направлений: a coach assigned to run one direction (see
// docs/design/2026-11-01-direction-managers.md). Only the club's admins assign.

export const DirectionManagerOutputSchema = z.object({
    id: z.string().uuid(),
    directionId: z.string().uuid(),
    userId: z.string().uuid(),
    email: z.string().nullable(),
    firstname: z.string().nullable(),
    lastname: z.string().nullable(),
    createdAt: z.iso.datetime(),
})
export type DirectionManagerOutput = z.infer<typeof DirectionManagerOutputSchema>

export const ListDirectionManagersOutputSchema = z.object({
    data: z.array(DirectionManagerOutputSchema),
})

export const AssignDirectionManagerInputSchema = z.object({
    directionId: z.string().uuid(),
    userId: z.string().uuid(),
})

export const RemoveDirectionManagerOutputSchema = z.object({
    status: z.literal('deleted'),
})

export class ListDirectionManagersFeature {
    constructor(
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type ListDirectionManagersFeatureResponse = z.infer<
    typeof ListDirectionManagersOutputSchema
>

export class AssignDirectionManagerFeature {
    constructor(
        readonly payload: z.infer<typeof AssignDirectionManagerInputSchema>,
        readonly workspaceId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type AssignDirectionManagerFeatureResponse = DirectionManagerOutput

export class RemoveDirectionManagerFeature {
    constructor(
        readonly workspaceId: string,
        readonly managerId: string,
        readonly invokerUserId: string,
        readonly roleName: string | null,
        readonly isSuperAdmin: boolean,
    ) {}
}
export type RemoveDirectionManagerFeatureResponse = z.infer<
    typeof RemoveDirectionManagerOutputSchema
>

export const directionManagerInclude = {
    user: {
        select: { id: true, email: true, firstname: true, lastname: true },
    },
} as const

export const serializeDirectionManager = (row: {
    id: string
    directionId: string
    userId: string
    createdAt: Date
    user: {
        email: string | null
        firstname: string | null
        lastname: string | null
    }
}): DirectionManagerOutput => ({
    id: row.id,
    directionId: row.directionId,
    userId: row.userId,
    email: row.user.email,
    firstname: row.user.firstname,
    lastname: row.user.lastname,
    createdAt: row.createdAt.toISOString(),
})
