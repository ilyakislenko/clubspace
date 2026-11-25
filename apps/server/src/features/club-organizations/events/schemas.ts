import { z } from 'zod'

import { registrationClosedReason } from '../../../domains/organizations/org-events'
import type { ClubOrgEventRow } from './club-org-events'

export const ClubOrgEventRegistrationRefSchema = z.object({
    id: z.string().uuid(),
    status: z.enum(['BOOKED', 'CANCELLED']),
})

export const ClubOrgEventOutputSchema = z.object({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    // «События федерации «…»».
    organizationName: z.string(),
    kind: z.enum(['COMPETITION', 'SEMINAR', 'CAMP', 'GRADING', 'MEETING', 'OTHER']),
    title: z.string(),
    description: z.string().nullable(),
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime().nullable(),
    timezone: z.string(),
    place: z.string().nullable(),
    address: z.string().nullable(),
    hostClubName: z.string().nullable(),
    audience: z.enum(['STAFF', 'STAFF_AND_MEMBERS']),
    capacity: z.number().int().nullable(),
    bookedCount: z.number().int(),
    // OPEN «Записаться», FULL «Мест нет», CLOSED (closed, started, not open).
    registrationState: z.enum(['OPEN', 'FULL', 'CLOSED']),
    registrationClosesAt: z.iso.datetime().nullable(),
    // Text only; paid outside the app.
    feeNote: z.string().nullable(),
    // The viewer's own booking (a child's when a guardian acts for it).
    myRegistration: ClubOrgEventRegistrationRefSchema.nullable(),
})
export type ClubOrgEventOutput = z.infer<typeof ClubOrgEventOutputSchema>

export const serializeClubOrgEvent = (
    e: ClubOrgEventRow,
    bookedCount: number,
    mine: { id: string; status: 'BOOKED' | 'CANCELLED' } | null,
    now: Date,
): ClubOrgEventOutput => ({
    id: e.id,
    organizationId: e.organizationId,
    organizationName: e.organization.name,
    kind: e.kind,
    title: e.title,
    description: e.description,
    startAt: e.startAt.toISOString(),
    endAt: e.endAt?.toISOString() ?? null,
    timezone: e.timezone,
    place: e.place,
    address: e.address,
    hostClubName: e.hostWorkspace?.name ?? null,
    audience: e.audience,
    capacity: e.capacity,
    bookedCount,
    registrationState: registrationClosedReason(e, now)
        ? 'CLOSED'
        : e.capacity !== null && bookedCount >= e.capacity
          ? 'FULL'
          : 'OPEN',
    registrationClosesAt: e.registrationClosesAt?.toISOString() ?? null,
    feeNote: e.feeNote,
    myRegistration: mine ? { id: mine.id, status: mine.status } : null,
})
