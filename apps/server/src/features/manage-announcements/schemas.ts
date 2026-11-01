import { z } from 'zod'

import {
    DirectionRefSchema,
    directionRefSelect,
    type DirectionRef,
} from '../../domains/directions/direction-ref'
import { fullNameWithoutEmail } from '../../shared/utils/person-name'

export const AnnouncementAudienceSchema = z.enum(['ALL', 'EXPIRING'])

export const AnnouncementOutputSchema = z.object({
    id: z.string().uuid(),
    title: z.string(),
    body: z.string(),
    pinned: z.boolean(),
    audience: AnnouncementAudienceSchema,
    // Only members of this direction (and the staff) see it; AND-ed with
    // `audience`. null = the whole club.
    direction: DirectionRefSchema.nullable(),
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

// What every announcement read/write includes for serializeAnnouncement.
export const ANNOUNCEMENT_INCLUDE = {
    author: { select: { firstname: true, lastname: true, email: true } },
    direction: directionRefSelect,
} as const

export const serializeAnnouncement = (a: {
    id: string
    title: string
    body: string
    pinned: boolean
    audience: 'ALL' | 'EXPIRING'
    direction: DirectionRef | null
    publishedAt: Date | null
    author: { firstname: string | null; lastname: string | null; email: string | null }
    createdAt: Date
    updatedAt: Date
}): AnnouncementOutput => ({
    id: a.id,
    title: a.title,
    body: a.body,
    pinned: a.pinned,
    audience: a.audience,
    direction: a.direction
        ? {
              id: a.direction.id,
              name: a.direction.name,
              color: a.direction.color,
              icon: a.direction.icon,
          }
        : null,
    publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
    authorName: fullNameWithoutEmail(a.author),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
})
