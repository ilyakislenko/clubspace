import { purgePersonalTraining } from './purge-personal-training'

const NOW = new Date('2026-10-24T09:00:00Z')

const makeTx = () => ({
    personalTrainingCoach: { deleteMany: jest.fn().mockResolvedValue({}) },
    attendanceSession: { deleteMany: jest.fn().mockResolvedValue({}) },
    personalTrainingRequest: { updateMany: jest.fn().mockResolvedValue({}) },
})

describe('purgePersonalTraining', () => {
    it('cancels open and future-confirmed requests on both sides, never past ones', async () => {
        const tx = makeTx()
        await purgePersonalTraining(tx as never, { userId: 'u1', now: NOW })
        const [asMember, asCoach] =
            tx.personalTrainingRequest.updateMany.mock.calls.map((c) => c[0])
        const openOrFuture = {
            OR: [
                { status: { in: ['PENDING_COACH', 'PENDING_MEMBER'] } },
                { status: 'CONFIRMED', confirmedStartAt: { gt: NOW } },
            ],
        }
        expect(asMember).toEqual({
            where: { memberId: 'u1', ...openOrFuture },
            data: { status: 'CANCELLED', closedByRole: 'member' },
        })
        expect(asCoach).toEqual({
            where: { coachId: 'u1', ...openOrFuture },
            data: { status: 'CANCELLED', closedByRole: 'coach' },
        })
    })

    it('scrubs the free-text fields of every request they took part in', async () => {
        const tx = makeTx()
        await purgePersonalTraining(tx as never, { userId: 'u1', now: NOW })
        expect(
            tx.personalTrainingRequest.updateMany.mock.calls[2][0],
        ).toEqual({
            where: { OR: [{ memberId: 'u1' }, { coachId: 'u1' }] },
            data: { memberComment: null, coachComment: null, closeComment: null },
        })
    })

    it('deletes only personal sessions without records, before the requests are touched', async () => {
        const tx = makeTx()
        const order: string[] = []
        tx.attendanceSession.deleteMany.mockImplementation(async () => {
            order.push('sessions')
        })
        tx.personalTrainingRequest.updateMany.mockImplementation(async () => {
            order.push('requests')
        })
        await purgePersonalTraining(tx as never, { userId: 'u1', now: NOW })
        expect(order[0]).toBe('sessions')
        expect(tx.attendanceSession.deleteMany).toHaveBeenCalledWith({
            where: {
                isPersonal: true,
                records: { none: {} },
                personalTraining: {
                    is: { OR: [{ memberId: 'u1' }, { coachId: 'u1' }] },
                },
            },
        })
    })

    it('opts the coach out, scoped to one club when asked', async () => {
        const tx = makeTx()
        await purgePersonalTraining(tx as never, {
            userId: 'u1',
            workspaceId: 'w1',
            now: NOW,
        })
        expect(tx.personalTrainingCoach.deleteMany).toHaveBeenCalledWith({
            where: { workspaceId: 'w1', userId: 'u1' },
        })
        for (const [arg] of tx.personalTrainingRequest.updateMany.mock.calls) {
            expect(arg.where.workspaceId).toBe('w1')
        }
    })
})
