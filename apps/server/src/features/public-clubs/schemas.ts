import { z } from 'zod'

import type { Prisma } from '../../infrastructure/prisma'
import { formatJoinCode } from '../../domains/workspace/join-code'
import {
    ClubAboutContactSchema,
    ClubAboutLinkSchema,
    serializeClubAbout,
} from '../club-about/schemas'

// What anyone on the internet may learn about a club. Deliberately no ids
// (workspace, gym, group) and no people: nothing here unlocks another endpoint
// or names a member or a coach. Contacts and links are the ones the club
// already publishes to its students under «О клубе».
export const PublicClubSchema = z.object({
    name: z.string(),
    type: z.string(),
    // Only for a listed club — /c/<slug> answers 404 otherwise.
    slug: z.string().nullable(),
    logoUrl: z.string().nullable(),
    description: z.string().nullable(),
    city: z.string().nullable(),
    gyms: z.array(z.object({ name: z.string(), address: z.string() })),
    // Weekly recurring classes per group; empty when the club hides its
    // schedule section. Times are wall-clock in `timezone`.
    schedule: z.array(
        z.object({
            group: z.string(),
            gym: z.string().nullable(),
            timezone: z.string(),
            slots: z.array(
                z.object({
                    // ISO 8601: 1 = Monday … 7 = Sunday.
                    dayOfWeek: z.number().int(),
                    startTime: z.string(),
                    durationMin: z.number().int(),
                }),
            ),
        }),
    ),
    contacts: z.array(ClubAboutContactSchema),
    links: z.array(ClubAboutLinkSchema),
    // The code to join with: echoed back on the by-code preview, and present
    // on a listed club's page (listing is the club opting in). Null otherwise.
    joinCode: z.string().nullable(),
    joinCodeDisplay: z.string().nullable(),
})

export type PublicClubOutput = z.infer<typeof PublicClubSchema>

export const PublicClubSummarySchema = z.object({
    slug: z.string(),
    name: z.string(),
    type: z.string(),
    city: z.string().nullable(),
    description: z.string().nullable(),
    logoUrl: z.string().nullable(),
})

export type PublicClubSummaryOutput = z.infer<typeof PublicClubSummarySchema>

// Slots in force today: started (or unbounded) and not yet ended. A slot that
// starts next month is not "the schedule" yet.
const effectiveSlotsWhere = (today: Date): Prisma.GroupScheduleSlotWhereInput => ({
    AND: [
        { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: today } }] },
        { OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: today } }] },
    ],
})

export const publicClubSelect = (today: Date) =>
    ({
        name: true,
        type: true,
        city: true,
        publicDescription: true,
        logoKey: true,
        isListed: true,
        isActive: true,
        scheduleEnabled: true,
        timezone: true,
        aboutContacts: true,
        aboutLinks: true,
        aboutRules: true,
        aboutUpdatedAt: true,
        publicSlugRow: { select: { slug: true } },
        joinCodeRow: { select: { code: true } },
        gyms: {
            select: { name: true, address: true },
            orderBy: { name: 'asc' },
        },
        groups: {
            select: {
                name: true,
                gym: { select: { name: true, timezone: true } },
                slots: {
                    where: effectiveSlotsWhere(today),
                    select: {
                        dayOfWeek: true,
                        startTime: true,
                        durationMin: true,
                    },
                    orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
                },
            },
            orderBy: { name: 'asc' },
        },
    }) satisfies Prisma.WorkspaceSelect

export type PublicClubRow = {
    name: string
    type: string
    city: string | null
    publicDescription: string | null
    isListed: boolean
    scheduleEnabled: boolean
    timezone: string
    aboutContacts: unknown
    aboutLinks: unknown
    aboutRules: string | null
    aboutUpdatedAt: Date | null
    publicSlugRow: { slug: string } | null
    gyms: { name: string; address: string }[]
    groups: {
        name: string
        gym: { name: string; timezone: string | null } | null
        slots: { dayOfWeek: number; startTime: string; durationMin: number }[]
    }[]
}

export const serializePublicClub = (
    row: PublicClubRow,
    extra: { logoUrl: string | null; joinCode: string | null },
): PublicClubOutput => {
    const about = serializeClubAbout(row)
    return {
        name: row.name,
        type: row.type,
        slug: row.isListed ? (row.publicSlugRow?.slug ?? null) : null,
        logoUrl: extra.logoUrl,
        description: row.publicDescription,
        city: row.city,
        gyms: row.gyms.map((g) => ({ name: g.name, address: g.address })),
        schedule: row.scheduleEnabled
            ? row.groups
                  .filter((g) => g.slots.length > 0)
                  .map((g) => ({
                      group: g.name,
                      gym: g.gym?.name ?? null,
                      timezone: g.gym?.timezone ?? row.timezone,
                      slots: g.slots.map((s) => ({
                          dayOfWeek: s.dayOfWeek,
                          startTime: s.startTime,
                          durationMin: s.durationMin,
                      })),
                  }))
            : [],
        contacts: about.contacts,
        links: about.links,
        joinCode: extra.joinCode,
        joinCodeDisplay: extra.joinCode ? formatJoinCode(extra.joinCode) : null,
    }
}
