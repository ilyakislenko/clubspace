import { z } from 'zod'

import {
    type DirectionRef,
    DirectionRefSchema,
} from '../../domains/directions/direction-ref'

// Ticket / host fields, shared by create and update. Omitted = unchanged on
// update; null = free / no limit / no guest host.
export const EventTicketInputFields = {
    // A guest teacher's name (free text) when the host is not a club member.
    hostName: z.string().trim().max(255).nullable().optional(),
    // Whole currency units, like a tariff's price.
    price: z.number().int().min(1).max(10_000_000).nullable().optional(),
    currency: z.string().trim().length(3).optional(),
    capacity: z.number().int().min(1).max(10_000).nullable().optional(),
}

export const EventOutputSchema = z.object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    title: z.string(),
    description: z.string().nullable(),
    link: z.string().nullable(),
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime(),
    timezone: z.string(),
    gym: z
        .object({
            id: z.string().uuid(),
            name: z.string(),
            address: z.string(),
        })
        .nullable(),
    direction: DirectionRefSchema.nullable(),
    coach: z
        .object({
            id: z.string().uuid(),
            email: z.string().nullable(),
            firstname: z.string().nullable(),
            lastname: z.string().nullable(),
        })
        .nullable(),
    // A guest teacher (not a club member), shown instead of `coach`.
    hostName: z.string().nullable(),
    // Ticket price in whole currency units; null = free.
    price: z.number().int().nullable(),
    currency: z.string(),
    // Places; null = no limit. With a price or a limit members register.
    capacity: z.number().int().nullable(),
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
    timezone: string
    gym: { id: string; name: string; address: string } | null
    direction: DirectionRef | null
    coach: {
        id: string
        email: string | null
        firstname: string | null
        lastname: string | null
    } | null
    hostName: string | null
    price: number | null
    currency: string
    capacity: number | null
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
    timezone: e.timezone,
    gym: e.gym,
    direction: e.direction,
    coach: e.coach,
    hostName: e.hostName,
    price: e.price,
    currency: e.currency,
    capacity: e.capacity,
    createdById: e.createdById,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
})
