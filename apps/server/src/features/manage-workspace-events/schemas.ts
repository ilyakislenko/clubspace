import { z } from 'zod'

export const EventOutputSchema = z.object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    title: z.string(),
    description: z.string().nullable(),
    link: z.string().nullable(),
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime(),
    gym: z
        .object({
            id: z.string().uuid(),
            name: z.string(),
            address: z.string(),
        })
        .nullable(),
    coach: z
        .object({
            id: z.string().uuid(),
            email: z.string(),
            firstname: z.string().nullable(),
            lastname: z.string().nullable(),
        })
        .nullable(),
    createdById: z.string().uuid(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})

export const DeletedOutputSchema = z.object({ status: z.literal('deleted') })

export type EventOutput = z.infer<typeof EventOutputSchema>

export const serializeEvent = (e: {
    id: string
    workspaceId: string
    title: string
    description: string | null
    link: string | null
    startAt: Date
    endAt: Date
    gym: { id: string; name: string; address: string } | null
    coach: {
        id: string
        email: string
        firstname: string | null
        lastname: string | null
    } | null
    createdById: string
    createdAt: Date
    updatedAt: Date
}): EventOutput => ({
    id: e.id,
    workspaceId: e.workspaceId,
    title: e.title,
    description: e.description,
    link: e.link,
    startAt: e.startAt.toISOString(),
    endAt: e.endAt.toISOString(),
    gym: e.gym,
    coach: e.coach,
    createdById: e.createdById,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
})
