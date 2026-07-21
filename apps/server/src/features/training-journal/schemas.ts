import { z } from 'zod'

export const JournalEntrySchema = z.object({
    id: z.string().uuid(),
    entryDate: z.string(), // yyyy-mm-dd
    body: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})

export type JournalEntryDto = z.infer<typeof JournalEntrySchema>

export const serializeEntry = (e: {
    id: string
    entryDate: Date
    body: string
    createdAt: Date
    updatedAt: Date
}): JournalEntryDto => ({
    id: e.id,
    entryDate: e.entryDate.toISOString().slice(0, 10),
    body: e.body,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
})
