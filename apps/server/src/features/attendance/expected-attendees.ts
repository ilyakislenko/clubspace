import { PrismaService } from '../../infrastructure/prisma'
import { displayName, ExpectedAttendee } from './schemas'

export type ExpectedSessionLike = {
    id: string
    workspaceId: string
    groupId: string | null
    slotId: string | null
    occurrenceKey: string
}

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
    if (!s.slotId) return []
    const bookings = await prisma.dropInBooking.findMany({
        where: {
            workspaceId: s.workspaceId,
            occurrenceKey: s.occurrenceKey,
            user: {
                groupMemberships: {
                    none: { groupId: s.groupId ?? undefined },
                },
                workspaceMemberships: {
                    some: { workspaceId: s.workspaceId, status: 'ACTIVE' },
                },
            },
        },
        orderBy: { createdAt: 'asc' },
        select: {
            userId: true,
            user: { select: { firstname: true, lastname: true, email: true } },
        },
    })
    return bookings.map((b) => ({
        userId: b.userId,
        displayName: displayName(b.user),
        present: presentIds.has(b.userId),
        source: 'booking' as const,
    }))
}
