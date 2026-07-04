import { z } from 'zod'

export const AnnouncementOutputSchema = z.object({
    id: z.string().uuid(),
    title: z.string(),
    body: z.string(),
    pinned: z.boolean(),
    publishedAt: z.iso.datetime().nullable(),
    authorName: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})
export type AnnouncementOutput = z.infer<typeof AnnouncementOutputSchema>

export const AnnouncementListOutputSchema = z.object({
    data: z.array(AnnouncementOutputSchema),
    total: z.number().int(),
    curPage: z.number().int(),
    perPage: z.number().int(),
})

export const AnnouncementDeletedOutputSchema = z.object({
    status: z.literal('deleted'),
})

const authorName = (a: {
    firstname: string | null
    lastname: string | null
    email: string
}): string =>
    [a.firstname, a.lastname].filter(Boolean).join(' ').trim() || a.email

export const serializeAnnouncement = (a: {
    id: string
    title: string
    body: string
    pinned: boolean
    publishedAt: Date | null
    author: { firstname: string | null; lastname: string | null; email: string }
    createdAt: Date
    updatedAt: Date
}): AnnouncementOutput => ({
    id: a.id,
    title: a.title,
    body: a.body,
    pinned: a.pinned,
    publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
    authorName: authorName(a.author),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
})
