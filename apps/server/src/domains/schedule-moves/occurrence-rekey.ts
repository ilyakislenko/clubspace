// A scheduled class is identified everywhere by
// scheduledOccurrenceKey(slotId, sessionDate). When the admin calendar moves a
// class to another slot and/or date, every row keyed on it follows, so places
// booked, guests, the opened roster and per-date capacity travel with the class.
import { scheduledOccurrenceKey } from '../../features/attendance/attendance-utils'
import type { PrismaTransactionClientType } from '../../infrastructure/prisma'
import { ymdToDbDate } from '../subscriptions/freeze-dates'

export type OccurrenceRekey = {
    workspaceId: string
    fromSlotId: string
    fromDate: string // yyyy-mm-dd
    toSlotId: string
    toDate: string // yyyy-mm-dd
    // The class's new absolute start/end.
    startAt: Date
    endAt: Date
}

// Runs inside the caller's transaction. The ClassOccurrence row lock is taken
// first (the same SELECT … FOR UPDATE as ClassBookingService.lock), so a
// booking racing the move either lands before it and travels, or waits and
// then finds the class under its new key. A substitute coach (pending or
// approved) travels with the class too.
export const rekeyOccurrence = async (
    tx: PrismaTransactionClientType,
    p: OccurrenceRekey,
): Promise<void> => {
    const fromKey = scheduledOccurrenceKey(p.fromSlotId, p.fromDate)
    const occurrenceKey = scheduledOccurrenceKey(p.toSlotId, p.toDate)
    const sessionDate = ymdToDbDate(p.toDate)

    const [occurrence] = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "ClassOccurrence" WHERE "workspaceId" = ${p.workspaceId}::uuid AND "occurrenceKey" = ${fromKey} FOR UPDATE`
    if (occurrence) {
        await tx.classOccurrence.update({
            where: { id: occurrence.id },
            data: {
                slotId: p.toSlotId,
                sessionDate,
                occurrenceKey,
                startAt: p.startAt,
                endAt: p.endAt,
            },
        })
    }
    await tx.dropInBooking.updateMany({
        where: { workspaceId: p.workspaceId, occurrenceKey: fromKey },
        data: { slotId: p.toSlotId, sessionDate, occurrenceKey },
    })
    await tx.attendanceSession.updateMany({
        where: { workspaceId: p.workspaceId, occurrenceKey: fromKey },
        data: {
            slotId: p.toSlotId,
            sessionDate,
            occurrenceKey,
            startAt: p.startAt,
        },
    })
    await tx.classSubstitution.updateMany({
        where: { workspaceId: p.workspaceId, occurrenceKey: fromKey },
        data: { slotId: p.toSlotId, sessionDate, occurrenceKey },
    })
}
