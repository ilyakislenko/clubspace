import { z } from 'zod'

import type { DemoRequest } from '../../infrastructure/prisma'

export const DemoRequestSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    clubName: z.string(),
    city: z.string().nullable(),
    contact: z.string(),
    studentsCount: z.number().int().nullable(),
    comment: z.string().nullable(),
    consentAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
})

export const serializeDemoRequest = (
    row: DemoRequest,
): z.infer<typeof DemoRequestSchema> => ({
    id: row.id,
    name: row.name,
    clubName: row.clubName,
    city: row.city,
    contact: row.contact,
    studentsCount: row.studentsCount,
    comment: row.comment,
    consentAt: row.consentAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
})
