import type { PrismaTransactionClientType } from '../../infrastructure/prisma'
import { purgePersonalTraining } from '../personal-trainings/purge-personal-training'

// Everything a membership owns in one club, removed together: the member row
// plus this club's bookings, roster places, assistant-coach seats, direction
// manager seats, open grading slots, freeze requests and personal training.
// The abonements stay as the club's sales history with no member
// (Subscription.workspaceMemberId SetNull): revenue and the renewal share keep
// counting them, the current lists don't. Shared by an admin removing a member
// and a member leaving the club. Other clubs are untouched. Returns the events
// where a place was given up: the caller hands them to the waitlists once this
// transaction commits (EventRegistrationService.promoteFreed).
export const purgeMembership = async (
    tx: PrismaTransactionClientType,
    p: { memberId: string; userId: string; workspaceId: string; now: Date },
): Promise<{ freedEventIds: string[] }> => {
    const { userId, workspaceId } = p
    await tx.workspaceMember.delete({ where: { id: p.memberId } })
    // Guest bookings are a member's privilege: they go with the membership.
    await tx.dropInBooking.deleteMany({ where: { workspaceId, userId } })
    // Their places / waitlist places in «Запись на занятие» classes are given
    // up (nothing burned; the rows stay as history). The minutely sweep hands
    // the freed places to the waitlists.
    await tx.classBooking.updateMany({
        where: { workspaceId, userId, status: { in: ['BOOKED', 'WAITLISTED'] } },
        data: { status: 'CANCELLED', cancelledAt: p.now },
    })
    // Their places in events with registration too (one live place per event).
    const freed = await tx.eventRegistration.findMany({
        where: { workspaceId, userId, status: 'BOOKED' },
        select: { eventId: true },
    })
    await tx.eventRegistration.updateMany({
        where: { workspaceId, userId, status: { in: ['BOOKED', 'WAITLISTED'] } },
        data: { status: 'CANCELLED', cancelledAt: p.now },
    })
    // Rosters and class reminders read these, so a former member must leave
    // this club's groups too. Assistant-coach rows go as well; the primary
    // coach row mirrors Group.coachId, which is a separate reassignment.
    await tx.groupMember.deleteMany({ where: { userId, group: { workspaceId } } })
    await tx.groupCoach.deleteMany({
        where: { userId, role: 'assistant', group: { workspaceId } },
    })
    await tx.directionManager.deleteMany({ where: { workspaceId, userId } })
    // Open grading slots go with the membership; PASSED/FAILED rows stay as
    // history.
    await tx.rankGradingCandidate.deleteMany({
        where: { workspaceId, userId, result: 'PENDING' },
    })
    // Their freeze requests (any status) go with the membership.
    await tx.subscriptionFreezeRequest.deleteMany({ where: { workspaceId, userId } })
    // Personal training goes too: offers, open requests, comments.
    await purgePersonalTraining(tx, { userId, workspaceId, now: p.now })
    return { freedEventIds: freed.map((r) => r.eventId) }
}
