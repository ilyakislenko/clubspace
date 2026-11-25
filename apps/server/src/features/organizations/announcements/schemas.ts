import { z } from 'zod'

export const OrganizationAudienceSchema = z.enum(['STAFF', 'STAFF_AND_MEMBERS'])

export const OrgAnnouncementOutputSchema = z.object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    title: z.string(),
    body: z.string(),
    // STAFF «Тренерам клубов»: a push to each member club's owner and staff;
    // STAFF_AND_MEMBERS «Тренерам и ученикам»: also the clubs' member feeds
    // (where the club allows it), never a member push.
    audience: OrganizationAudienceSchema,
    // null = draft, future = scheduled.
    publishedAt: z.iso.datetime().nullable(),
    // When every member club's staff got the push (quiet hours delay it).
    staffNotifiedAt: z.iso.datetime().nullable(),
    authorName: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})
export type OrgAnnouncementOutput = z.infer<typeof OrgAnnouncementOutputSchema>

export const OrgAnnouncementListOutputSchema = z.object({
    data: z.array(OrgAnnouncementOutputSchema),
    total: z.number().int(),
    curPage: z.number().int(),
    perPage: z.number().int(),
})

export const OrgAnnouncementDeletedOutputSchema = z.object({
    status: z.literal('deleted'),
})

export const serializeOrgAnnouncement = (a: {
    id: string
    organizationId: string
    title: string
    body: string
    audience: 'STAFF' | 'STAFF_AND_MEMBERS'
    publishedAt: Date | null
    staffNotifiedAt: Date | null
    authorName: string
    createdAt: Date
    updatedAt: Date
}): OrgAnnouncementOutput => ({
    id: a.id,
    organizationId: a.organizationId,
    title: a.title,
    body: a.body,
    audience: a.audience,
    publishedAt: a.publishedAt?.toISOString() ?? null,
    staffNotifiedAt: a.staffNotifiedAt?.toISOString() ?? null,
    authorName: a.authorName,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
})

// `publishAt` wins over `publish`; `publish: true` keeps an already-live time.
export const resolvePublishedAt = (
    p: { publish?: boolean; publishAt?: string },
    current: Date | null,
    now: Date,
): Date | null | undefined => {
    if (p.publishAt) return new Date(p.publishAt)
    if (p.publish === true) return current && current <= now ? current : now
    if (p.publish === false) return null
    return undefined
}
