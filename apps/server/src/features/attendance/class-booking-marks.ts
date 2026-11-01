// Keeps «Запись на занятие» bookings in step with attendance marks (coach
// marking, self check-in, un-mark). The visit itself is charged as always;
// this only moves the booking's status — and gives back a class a no-show
// burned when the member turns out to have been there.
import type { PrismaTransactionClientType } from '../../infrastructure/prisma'
import { refundConsumedClass } from './session-visits'

type Tx = Pick<PrismaTransactionClientType, 'classBooking' | 'subscription'>

// Marked present: the booking (a place, a waitlist place, or a no-show the
// sweep already recorded) becomes ATTENDED; a burned no-show is refunded.
export const markClassBookingsAttended = async (
    tx: Tx,
    p: { workspaceId: string; occurrenceKey: string; userIds: readonly string[] },
): Promise<void> => {
    if (p.userIds.length === 0) return
    const rows = await tx.classBooking.findMany({
        where: {
            workspaceId: p.workspaceId,
            userId: { in: [...p.userIds] },
            occurrence: { workspaceId: p.workspaceId, occurrenceKey: p.occurrenceKey },
            status: { in: ['BOOKED', 'WAITLISTED', 'NO_SHOW'] },
        },
        select: { id: true, classBurned: true, burnedSubscriptionId: true },
    })
    if (rows.length === 0) return
    for (const r of rows) {
        if (r.classBurned && r.burnedSubscriptionId) {
            await refundConsumedClass(tx, r.burnedSubscriptionId)
        }
    }
    await tx.classBooking.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { status: 'ATTENDED', classBurned: false, burnedSubscriptionId: null },
    })
}

// Un-marked: back to a held place while the class is still open; once the
// sweep has closed it, a no-show — without a burn (a staff correction).
export const unmarkClassBooking = async (
    tx: Tx,
    p: { workspaceId: string; occurrenceKey: string; userId: string },
): Promise<void> => {
    const row = await tx.classBooking.findFirst({
        where: {
            workspaceId: p.workspaceId,
            userId: p.userId,
            occurrence: { workspaceId: p.workspaceId, occurrenceKey: p.occurrenceKey },
            status: 'ATTENDED',
        },
        select: { id: true, occurrence: { select: { settledAt: true } } },
    })
    if (!row) return
    await tx.classBooking.update({
        where: { id: row.id },
        data: { status: row.occurrence.settledAt ? 'NO_SHOW' : 'BOOKED' },
    })
}
