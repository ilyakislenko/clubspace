import { z } from 'zod'

export const OrganizationEventKindSchema = z.enum([
    'COMPETITION',
    'SEMINAR',
    'CAMP',
    'GRADING',
    'MEETING',
    'OTHER',
])
export const OrgEventAudienceSchema = z.enum(['STAFF', 'STAFF_AND_MEMBERS'])

// Wall clock YYYY-MM-DDTHH:MM (seconds optional) in the event's zone, as the
// club event form sends it.
export const OrgEventWallClock = z
    .string()
    .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/,
        'Время должно быть в формате YYYY-MM-DDTHH:MM',
    )

export const OrgEventOutputSchema = z.object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    kind: OrganizationEventKindSchema,
    title: z.string(),
    description: z.string().nullable(),
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime().nullable(),
    timezone: z.string(),
    place: z.string().nullable(),
    address: z.string().nullable(),
    // «Принимает клуб X».
    hostClub: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
    // STAFF: coaches of member clubs only; STAFF_AND_MEMBERS: also members
    // of clubs that allow federation events.
    audience: OrgEventAudienceSchema,
    capacity: z.number().int().nullable(),
    registrationOpen: z.boolean(),
    registrationClosesAt: z.iso.datetime().nullable(),
    // «Взнос 1 500 ₽ на месте» — text only, paid outside the app.
    feeNote: z.string().nullable(),
    // null = draft.
    publishedAt: z.iso.datetime().nullable(),
    bookedCount: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})
export type OrgEventOutput = z.infer<typeof OrgEventOutputSchema>

export const ORG_EVENT_INCLUDE = {
    hostWorkspace: { select: { id: true, name: true } },
} as const

export const serializeOrgEvent = (
    e: {
        id: string
        organizationId: string
        kind: z.infer<typeof OrganizationEventKindSchema>
        title: string
        description: string | null
        startAt: Date
        endAt: Date | null
        timezone: string
        place: string | null
        address: string | null
        hostWorkspace: { id: string; name: string } | null
        audience: 'STAFF' | 'STAFF_AND_MEMBERS'
        capacity: number | null
        registrationOpen: boolean
        registrationClosesAt: Date | null
        feeNote: string | null
        publishedAt: Date | null
        createdAt: Date
        updatedAt: Date
    },
    bookedCount: number,
): OrgEventOutput => ({
    id: e.id,
    organizationId: e.organizationId,
    kind: e.kind,
    title: e.title,
    description: e.description,
    startAt: e.startAt.toISOString(),
    endAt: e.endAt?.toISOString() ?? null,
    timezone: e.timezone,
    place: e.place,
    address: e.address,
    hostClub: e.hostWorkspace
        ? { id: e.hostWorkspace.id, name: e.hostWorkspace.name }
        : null,
    audience: e.audience,
    capacity: e.capacity,
    registrationOpen: e.registrationOpen,
    registrationClosesAt: e.registrationClosesAt?.toISOString() ?? null,
    feeNote: e.feeNote,
    publishedAt: e.publishedAt?.toISOString() ?? null,
    bookedCount,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
})

// Fields shared by create and update (all optional on update).
export const OrgEventFields = {
    kind: OrganizationEventKindSchema,
    title: z.string().trim().min(1).max(255),
    description: z.string().trim().max(5000).nullable(),
    startAt: OrgEventWallClock,
    endAt: OrgEventWallClock.nullable(),
    // IANA zone of the place; default the org's.
    timezone: z.string().min(1).max(64),
    place: z.string().trim().max(255).nullable(),
    address: z.string().trim().max(500).nullable(),
    // A member club hosting it (ACTIVE in the org); null = none.
    hostClubId: z.string().uuid().nullable(),
    audience: OrgEventAudienceSchema,
    capacity: z.number().int().min(1).max(100000).nullable(),
    registrationOpen: z.boolean(),
    registrationClosesAt: OrgEventWallClock.nullable(),
    feeNote: z.string().trim().max(255).nullable(),
    // Show to clubs now (true) or keep as a draft (false).
    publish: z.boolean(),
}
