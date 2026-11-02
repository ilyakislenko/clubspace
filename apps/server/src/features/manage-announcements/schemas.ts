import { z } from 'zod'

import {
    DirectionRefSchema,
    directionRefSelect,
    type DirectionRef,
} from '../../domains/directions/direction-ref'
import { fullNameWithoutEmail } from '../../shared/utils/person-name'

export const AnnouncementAudienceSchema = z.enum(['ALL', 'EXPIRING'])

// A target group in the DTO; the hall tells same-named groups apart.
export const AnnouncementGroupRefSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    gymName: z.string().nullable(),
    directionId: z.string().uuid().nullable(),
})

export const AnnouncementOutputSchema = z.object({
    id: z.string().uuid(),
    title: z.string(),
    body: z.string(),
    pinned: z.boolean(),
    audience: AnnouncementAudienceSchema,
    // Only members of this direction (and the staff) see it; AND-ed with
    // `audience`. null with no `groups` = the whole club.
    direction: DirectionRefSchema.nullable(),
    // Addressed to these groups instead of a direction: only their students
    // (and a child's guardians), their coaches and the staff see it.
    groups: z.array(AnnouncementGroupRefSchema),
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
    groups: {
        select: {
            groupId: true,
            group: {
                select: {
                    id: true,
                    name: true,
                    directionId: true,
                    gym: { select: { name: true } },
                },
            },
        },
    },
} as const

type StoredTargetGroup = {
    groupId: string | null
    group: {
        id: string
        name: string
        directionId: string | null
        gym: { name: string } | null
    } | null
}

export const serializeAnnouncement = (a: {
    id: string
    title: string
    body: string
    pinned: boolean
    audience: 'ALL' | 'EXPIRING'
    direction: DirectionRef | null
    groups: StoredTargetGroup[]
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
    // A row whose group was deleted matches nobody; nothing to show for it.
    groups: a.groups.flatMap(({ group }) =>
        group
            ? [
                  {
                      id: group.id,
                      name: group.name,
                      gymName: group.gym?.name ?? null,
                      directionId: group.directionId,
                  },
              ]
            : [],
    ),
    publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
    authorName: fullNameWithoutEmail(a.author),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
})
