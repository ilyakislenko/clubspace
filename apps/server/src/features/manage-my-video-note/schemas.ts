import { z } from 'zod'

export const MyVideoNoteSchema = z.object({
    text: z.string(),
    // null = never written; text '' with a date = cleared (tombstone).
    updatedAt: z.iso.datetime().nullable(),
})

export type MyVideoNote = z.infer<typeof MyVideoNoteSchema>

export const serializeMyVideoNote = (
    row: { text: string; updatedAt: Date } | null,
): MyVideoNote =>
    row
        ? { text: row.text, updatedAt: row.updatedAt.toISOString() }
        : { text: '', updatedAt: null }
