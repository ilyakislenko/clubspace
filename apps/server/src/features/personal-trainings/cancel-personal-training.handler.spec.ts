import {
    BadRequestError,
    ConflictError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { CancelPersonalTrainingFeature } from './cancel-personal-training.feature'
import { CancelPersonalTrainingHandler } from './cancel-personal-training.handler'

// Saturday 2026-10-24 09:00Z.
const NOW = new Date('2026-10-24T09:00:00Z')

const person = (id: string, firstname: string) => ({
    id,
    firstname,
    lastname: null,
    email: `${id}@x`,
})

const makeRow = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    workspaceId: 'w1',
    status: 'PENDING_COACH',
    memberId: 'm1',
    coachId: 'c1',
    member: person('m1', 'Ann'),
    coach: person('c1', 'Bob'),
    gym: null,
    timezone: 'Asia/Tomsk',
    options: [
        {
            id: 'o1',
            startAt: new Date('2026-10-31T12:00:00Z'),
            durationMin: 60,
            proposedBy: 'member',
            createdAt: new Date('2026-10-24T08:00:00Z'),
        },
    ],
    confirmedStartAt: null,
    confirmedDurationMin: null,
    sessionId: null,
    memberComment: null,
    coachComment: null,
    closeComment: null,
    closedByRole: null,
    createdAt: new Date('2026-10-24T08:00:00Z'),
    updatedAt: new Date('2026-10-24T08:00:00Z'),
    ...over,
})

const confirmed = (over: Record<string, unknown> = {}) =>
    makeRow({
        status: 'CONFIRMED',
        confirmedStartAt: new Date('2026-11-01T03:00:00Z'),
        confirmedDurationMin: 60,
        sessionId: 'sess1',
        ...over,
    })

const makePrisma = (row = makeRow()) => {
    const p: any = {
        personalTrainingRequest: {
            findFirst: jest.fn().mockResolvedValue(row),
            findUniqueOrThrow: jest.fn().mockResolvedValue({ ...row, status: 'CANCELLED' }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        attendanceRecord: { count: jest.fn().mockResolvedValue(0) },
        attendanceSession: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    }
    p.$transaction = jest.fn(async (fn: (t: unknown) => unknown) => fn(p))
    return p
}

const makeRbac = (admin = false) => ({
    resolveCoachScope: jest.fn().mockImplementation(async () => {
        if (!admin) throw new Error('forbidden')
        return { scope: 'admin' }
    }),
    canWriteAllGroups: jest.fn().mockReturnValue(admin),
})

const build = (row = makeRow(), admin = false) => {
    const prisma = makePrisma(row)
    const notifyUser = jest.fn().mockResolvedValue(true)
    const realtime = { invalidateUsers: jest.fn() }
    const handler = new CancelPersonalTrainingHandler(
        prisma as never,
        makeRbac(admin) as never,
        { notifyUser } as never,
        realtime as never,
    )
    return { handler, prisma, notifyUser, realtime }
}

const run = (
    handler: CancelPersonalTrainingHandler,
    invoker: string,
    comment?: string,
) =>
    handler.execute(
        new CancelPersonalTrainingFeature(
            { comment },
            'w1',
            'r1',
            invoker,
            'coach',
            false,
        ),
    )

describe('CancelPersonalTrainingHandler', () => {
    beforeEach(() => {
        jest.useFakeTimers({
            now: NOW,
            doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'queueMicrotask'],
        })
    })
    afterEach(() => jest.useRealTimers())

    it('is NotFound for an unknown request and for a stranger', async () => {
        const a = build()
        a.prisma.personalTrainingRequest.findFirst.mockResolvedValue(null)
        await expect(run(a.handler, 'm1')).rejects.toBeInstanceOf(NotFoundError)
        const b = build()
        await expect(run(b.handler, 'stranger')).rejects.toBeInstanceOf(NotFoundError)
    })

    it('refuses an already closed request', async () => {
        for (const status of ['DECLINED', 'CANCELLED']) {
            const { handler } = build(makeRow({ status }))
            await expect(run(handler, 'm1')).rejects.toBeInstanceOf(ConflictError)
        }
    })

    it('the member withdraws a pending request; the coach hears with the first option\'s time', async () => {
        const { handler, prisma, notifyUser, realtime } = build()
        const out = await run(handler, 'm1', 'Не получится')
        expect(prisma.personalTrainingRequest.updateMany.mock.calls[0][0]).toEqual({
            where: { id: 'r1', status: 'PENDING_COACH' },
            data: {
                status: 'CANCELLED',
                closedByRole: 'member',
                closeComment: 'Не получится',
                sessionId: null,
            },
        })
        expect(prisma.attendanceSession.deleteMany).not.toHaveBeenCalled()
        expect(out.status).toBe('CANCELLED')
        expect(realtime.invalidateUsers).toHaveBeenCalledWith(
            ['m1', 'c1'],
            ['personal-trainings'],
        )
        expect(notifyUser).toHaveBeenCalledTimes(1)
        expect(notifyUser.mock.calls[0][0]).toMatchObject({
            userId: 'c1',
            kind: 'personal.cancelled',
            refId: 'r1:cancelled:c1',
            topic: 'Персональная тренировка отменена',
            message: 'Ann · 31.10 в 19:00 — «Не получится»',
        })
    })

    it('the coach withdraws their proposal (PENDING_MEMBER)', async () => {
        const { handler, prisma } = build(makeRow({ status: 'PENDING_MEMBER' }))
        await run(handler, 'c1')
        expect(prisma.personalTrainingRequest.updateMany.mock.calls[0][0].data).toMatchObject({
            status: 'CANCELLED',
            closedByRole: 'coach',
            closeComment: null,
        })
    })

    it('cancelling a confirmed request deletes its personal session', async () => {
        const { handler, prisma, notifyUser } = build(confirmed())
        await run(handler, 'c1')
        expect(prisma.attendanceRecord.count.mock.calls[0][0].where).toEqual({
            sessionId: 'sess1',
        })
        expect(prisma.attendanceSession.deleteMany.mock.calls[0][0].where).toEqual({
            id: 'sess1',
            isPersonal: true,
        })
        expect(notifyUser.mock.calls[0][0]).toMatchObject({
            userId: 'm1',
            message: 'Bob · 01.11 в 10:00',
        })
    })

    it('refuses once attendance was marked', async () => {
        const { handler, prisma } = build(confirmed())
        prisma.attendanceRecord.count.mockResolvedValue(1)
        await expect(run(handler, 'c1')).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.attendanceSession.deleteMany).not.toHaveBeenCalled()
    })

    it('refuses a confirmed session that already started', async () => {
        const { handler } = build(
            confirmed({ confirmedStartAt: new Date('2026-10-24T08:00:00Z') }),
        )
        await expect(run(handler, 'c1')).rejects.toBeInstanceOf(BadRequestError)
    })

    it('conflicts and keeps the session when the status changed underneath', async () => {
        const { handler, prisma, notifyUser } = build(confirmed())
        prisma.personalTrainingRequest.updateMany.mockResolvedValue({ count: 0 })
        await expect(run(handler, 'c1')).rejects.toBeInstanceOf(ConflictError)
        expect(prisma.attendanceSession.deleteMany).not.toHaveBeenCalled()
        expect(notifyUser).not.toHaveBeenCalled()
    })

    it('lets an admin cancel as the coach and tells both sides', async () => {
        const { handler, prisma, notifyUser } = build(makeRow(), true)
        await run(handler, 'admin1')
        expect(prisma.personalTrainingRequest.updateMany.mock.calls[0][0].data.closedByRole).toBe('coach')
        expect(notifyUser.mock.calls.map((c) => c[0].refId)).toEqual([
            'r1:cancelled:m1',
            'r1:cancelled:c1',
        ])
    })

    it('still succeeds when the notification fails', async () => {
        const { handler, notifyUser } = build()
        notifyUser.mockRejectedValue(new Error('push down'))
        await expect(run(handler, 'm1')).resolves.toMatchObject({ status: 'CANCELLED' })
    })
})
