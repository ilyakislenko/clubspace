import { z } from 'zod'

import {
    DirectionRefSchema,
    directionRefSelect,
    type DirectionRef,
} from '../../domains/directions/direction-ref'
import { fullNameWithoutEmail } from '../../shared/utils/person-name'

export const AnnouncementAudienceSchema = z.enum(['ALL', 'EXPIRING'])

// What create/update accept: only the whole audience. «Только на продление»
// (EXPIRING) moved to «Сообщения → Продлить» — a private nudge is a message,
// not a feed post (docs/design/2026-11-26-broadcast-and-direct-messages.md
// §4.4); stored EXPIRING rows keep their filter until deleted.
export const EXPIRING_MOVED_MESSAGE = 'Используйте «Сообщения → Продлить»'
export const AnnouncementAudienceInputSchema = z.literal('ALL', { error: EXPIRING_MOVED_MESSAGE })

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
    // Every target group was deleted since: `groups` is empty, yet the
    // announcement still matches nobody — it is not the whole club.
    groupsRemoved: z.boolean(),
    publishedAt: z.iso.datetime().nullable(),
    authorName: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    // Set on a federation announcement merged into the feed («Федерация
    // «…»», read-only); absent on the club's own.
    source: z
        .object({
            kind: z.literal('organization'),
            organizationId: z.string().uuid(),
            name: z.string(),
        })
        .optional(),
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
    groupsRemoved: a.groups.length > 0 && a.groups.every(({ group }) => !group),
    publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
    authorName: fullNameWithoutEmail(a.author),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
})

// What the feed reads of a federation announcement for serializeOrgFeedItem.
export const ORG_FEED_SELECT = {
    id: true,
    organizationId: true,
    title: true,
    body: true,
    publishedAt: true,
    authorName: true,
    createdAt: true,
    updatedAt: true,
    organization: { select: { name: true } },
} as const

// A federation announcement in a club feed: never pinned, whole club, no
// direction or groups (design docs/design/2026-11-26-federation-hub-mvp.md §3.3).
export const serializeOrgFeedItem = (a: {
    id: string
    organizationId: string
    title: string
    body: string
    publishedAt: Date | null
    authorName: string
    createdAt: Date
    updatedAt: Date
    organization: { name: string }
}): AnnouncementOutput => ({
    id: a.id,
    title: a.title,
    body: a.body,
    pinned: false,
    audience: 'ALL',
    direction: null,
    groups: [],
    groupsRemoved: false,
    publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
    authorName: a.authorName,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    source: {
        kind: 'organization',
        organizationId: a.organizationId,
        name: a.organization.name,
    },
})
