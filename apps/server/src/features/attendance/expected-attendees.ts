import {
    isSubscriptionUsable,
    subscriptionUsabilitySelect,
} from '../../domains/subscriptions/subscription-status'
import { PrismaService } from '../../infrastructure/prisma'
import { displayName, ExpectedAttendee } from './schemas'

export type ExpectedSessionLike = {
    id: string
    workspaceId: string
    groupId: string | null
    slotId: string | null
    occurrenceKey: string
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
                // Filled by buildRoster, which owns the club-calendar day lookup.
                frozenUntil: null,
                // Paid off-app: no group pack is ever drawn.
                classesLeft: null,
            },
        ]
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
                select: {
                    firstname: true,
                    lastname: true,
                    email: true,
                    workspaceMemberships: {
                        where: { workspaceId: s.workspaceId },
                        select: {
                            subscription: {
                                select: {
                                    classesRemaining: true,
                                    ...subscriptionUsabilitySelect,
                                },
                            },
                        },
                    },
                },
            },
        },
    })
    const now = new Date()
    return bookings.map((b) => {
        const sub = b.user.workspaceMemberships[0]?.subscription ?? null
        return {
            userId: b.userId,
            displayName: displayName(b.user),
            present: presentIds.has(b.userId),
            source: 'booking' as const,
            // Filled by buildRoster, which owns the club-calendar day lookup.
            frozenUntil: null,
            classesLeft: isSubscriptionUsable(sub, now)
                ? (sub?.classesRemaining ?? null)
                : null,
        }
    })
}
