import { Prisma } from '../../infrastructure/prisma'

// Takes a person out of personal training: their opt-in goes, their open and
// future requests are closed, free text is scrubbed and the sessions nobody
// attended are removed. Past, attended sessions stay (Progress counts them).
// Scoped to one club when `workspaceId` is given (membership removal), else
// every club (account deletion). Runs inside the caller's transaction.
export const purgePersonalTraining = async (
    tx: Prisma.TransactionClient,
    p: { userId: string; workspaceId?: string; now: Date },
): Promise<void> => {
    const scope = p.workspaceId ? { workspaceId: p.workspaceId } : {}
    const involved = {
        ...scope,
        OR: [{ memberId: p.userId }, { coachId: p.userId }],
    }

    await tx.personalTrainingCoach.deleteMany({
        where: { ...scope, userId: p.userId },
    })
    // Sessions first: deleting one nulls the request's sessionId, which the
    // filter below reads.
    await tx.attendanceSession.deleteMany({
        where: {
            ...scope,
            isPersonal: true,
            records: { none: {} },
            personalTraining: { is: involved },
        },
    })
    const openOrFuture: Prisma.PersonalTrainingRequestWhereInput = {
        OR: [
            { status: { in: ['PENDING_COACH', 'PENDING_MEMBER'] } },
            { status: 'CONFIRMED', confirmedStartAt: { gt: p.now } },
        ],
    }
    await tx.personalTrainingRequest.updateMany({
        where: { ...scope, memberId: p.userId, ...openOrFuture },
        data: { status: 'CANCELLED', closedByRole: 'member' },
    })
    await tx.personalTrainingRequest.updateMany({
        where: { ...scope, coachId: p.userId, ...openOrFuture },
        data: { status: 'CANCELLED', closedByRole: 'coach' },
    })
    await tx.personalTrainingRequest.updateMany({
        where: involved,
        data: { memberComment: null, coachComment: null, closeComment: null },
    })
}
