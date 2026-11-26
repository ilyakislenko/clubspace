import { z } from 'zod'

import { registrationClosedReason } from '../../../domains/organizations/org-events'
import type { ClubOrgEventRow } from './club-org-events'

export const ClubOrgEventRegistrationRefSchema = z.object({
    id: z.string().uuid(),
    status: z.enum(['BOOKED', 'CANCELLED']),
})

export const ClubOrgEventTournamentSchema = z.object({
    id: z.string().uuid(),
    status: z.enum(['SETUP', 'WEIGH_IN', 'RUNNING', 'FINISHED']),
    toConfirmCount: z.number().int().nullable(),
})
export type ClubOrgEventTournament = z.infer<typeof ClubOrgEventTournamentSchema>

// NEEDS_WEIGHT «Укажите вес для заявки» (booked, SETUP, no entry yet) ·
// AWAITING_COACH «Заявка у тренера» · CONFIRMED (division / mat / place) ·
// WITHDRAWN.
export const ClubOrgEventEntryStateSchema = z.object({
    state: z.enum(['NEEDS_WEIGHT', 'AWAITING_COACH', 'CONFIRMED', 'WITHDRAWN']),
    divisionName: z.string().nullable(),
    // The next match: «Ковёр 2 · перед вами 2 схватки».
    mat: z.number().int().nullable(),
    ahead: z.number().int().nullable(),
    place: z.number().int().nullable(),
})
export type ClubOrgEventEntryState = z.infer<typeof ClubOrgEventEntryStateSchema>

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
    // The tournament of a COMPETITION event (docs/design/2026-11-27-tournaments.md);
    // `toConfirmCount` for the club's staff only («Ждут подтверждения: 3»).
    tournament: ClubOrgEventTournamentSchema.nullable(),
    // The viewer's (or the child's) entry line for the Events row; null
    // without a tournament or a live booking.
    myEntryState: ClubOrgEventEntryStateSchema.nullable(),
})
export type ClubOrgEventOutput = z.infer<typeof ClubOrgEventOutputSchema>

export const serializeClubOrgEvent = (
    e: ClubOrgEventRow,
    bookedCount: number,
    mine: { id: string; status: 'BOOKED' | 'CANCELLED' } | null,
    now: Date,
    tournament: ClubOrgEventTournament | null,
    myEntryState: ClubOrgEventEntryState | null,
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
    tournament,
    myEntryState,
})
