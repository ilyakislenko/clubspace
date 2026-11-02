import { PrismaService } from '../../infrastructure/prisma'
import { displayName, ExpectedAttendee } from './schemas'

// What buildRoster fills in for every row in one batch (it owns the
// club-calendar day and the abonement lookups).
const filledByRoster = {
    frozenUntil: null,
    classesLeft: null,
    abonement: null,
    abonementOptions: [],
}

export type ExpectedSessionLike = {
    id: string
    workspaceId: string
    groupId: string | null
    slotId: string | null
    occurrenceKey: string
    workspaceEventId: string | null
    isPersonal: boolean
}

// A booking only counts while its booker is still an active member of the
// club. Shared with the schedule's guest count so the two always agree.
export const activeBookerWhere = (workspaceId: string) => ({
    workspaceMemberships: {
        some: { workspaceId, status: 'ACTIVE' as const },
    },
})

// Members of other groups who booked this scheduled class («Приду на
// тренировку»), so the coach sees who is coming before anyone is marked.
// Bookings are keyed to the occurrence, not the session, so they are found by
// occurrenceKey. Members of the session's own group are never "expected" (they
// come without booking) and a booking from a member who is no longer active is
// ignored.
export const loadExpectedAttendees = async (
    prisma: PrismaService,
    s: ExpectedSessionLike,
    presentIds: ReadonlySet<string>,
): Promise<ExpectedAttendee[]> => {
    if (s.isPersonal) {
        const request = await prisma.personalTrainingRequest.findUnique({
            where: { sessionId: s.id },
            select: {
                memberId: true,
                member: {
                    select: { firstname: true, lastname: true, email: true },
                },
            },
        })
        if (!request) return []
        return [
            {
                userId: request.memberId,
                displayName: displayName(request.member),
                present: presentIds.has(request.memberId),
                source: 'personal' as const,
                // Paid off-app: no abonement is ever drawn, so the abonement
                // fields stay empty.
                ...filledByRoster,
            },
        ]
    }
    // An event with registration (a master class): the members holding a
    // place are its list, like a «Запись на занятие» class.
    if (s.workspaceEventId) {
        const places = await prisma.eventRegistration.findMany({
            where: { eventId: s.workspaceEventId, status: 'BOOKED' },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: {
                userId: true,
                user: {
                    select: { firstname: true, lastname: true, email: true },
                },
            },
        })
        return places.map((b) => ({
            userId: b.userId,
            displayName: displayName(b.user),
            present: presentIds.has(b.userId),
            source: 'booking' as const,
            ...filledByRoster,
        }))
    }
    if (!s.slotId) return []
    const bookings = await prisma.dropInBooking.findMany({
        where: {
            workspaceId: s.workspaceId,
            occurrenceKey: s.occurrenceKey,
            user: {
                groupMemberships: {
                    none: { groupId: s.groupId ?? undefined },
                },
                ...activeBookerWhere(s.workspaceId),
            },
        },
        orderBy: { createdAt: 'asc' },
        select: {
            userId: true,
            user: {
                select: { firstname: true, lastname: true, email: true },
            },
        },
    })
    // «Запись на занятие»: everyone holding a place in this class (booked,
    // already marked, or a no-show the sweep recorded), group member or not —
    // in a BOOKING group the bookings are the class list. A class of a fixed
    // group has no such rows.
    const places = await prisma.classBooking.findMany({
        where: {
            workspaceId: s.workspaceId,
            occurrence: {
                workspaceId: s.workspaceId,
                occurrenceKey: s.occurrenceKey,
            },
            status: { in: ['BOOKED', 'ATTENDED', 'NO_SHOW'] },
        },
        orderBy: { createdAt: 'asc' },
        select: {
            userId: true,
            user: {
                select: { firstname: true, lastname: true, email: true },
            },
        },
    })
    return [...bookings, ...places].map((b) => ({
        userId: b.userId,
        displayName: displayName(b.user),
        present: presentIds.has(b.userId),
        source: 'booking' as const,
        ...filledByRoster,
    }))
}
