import {
    BadRequestError,
    ConflictError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { AcceptPersonalTrainingFeature } from './accept-personal-training.feature'
import { AcceptPersonalTrainingHandler } from './accept-personal-training.handler'

// Saturday 2026-10-24 09:00Z.
const NOW = new Date('2026-10-24T09:00:00Z')

const person = (id: string, firstname: string) => ({
    id,
    firstname,
    lastname: null,
    email: `${id}@x`,
})

const option = (
    id: string,
    proposedBy: 'member' | 'coach',
    startAt: string,
    createdAt: string,
) => ({
    id,
    startAt: new Date(startAt),
    durationMin: 60,
    proposedBy,
    createdAt: new Date(createdAt),
})

const makeRow = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    workspaceId: 'w1',
    status: 'PENDING_COACH',
    memberId: 'm1',
    coachId: 'c1',
    member: person('m1', 'Ann'),
    coach: person('c1', 'Bob'),
    gym: { id: 'g1', name: 'Манеж', address: 'ул. 1' },
    timezone: 'Asia/Tomsk',
    options: [
        option('o1', 'member', '2026-10-31T12:00:00Z', '2026-10-24T08:00:00Z'),
        option('o2', 'member', '2026-11-01T03:00:00Z', '2026-10-24T08:00:00Z'),
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

const makePrisma = (row = makeRow()) => {
    const p: any = {
        personalTrainingRequest: {
            findFirst: jest.fn().mockResolvedValue(row),
            findUniqueOrThrow: jest.fn().mockResolvedValue({
                ...row,
                status: 'CONFIRMED',
                sessionId: 'sess1',
            }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        attendanceSession: {
            create: jest.fn().mockResolvedValue({ id: 'sess1' }),
        },
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
    const handler = new AcceptPersonalTrainingHandler(
        prisma as never,
        makeRbac(admin) as never,
        { notifyUser } as never,
        realtime as never,
    )
    return { handler, prisma, notifyUser, realtime }
}

const run = (
    handler: AcceptPersonalTrainingHandler,
    optionId: string,
    invoker: string,
) =>
    handler.execute(
        new AcceptPersonalTrainingFeature(
            { optionId },
            'w1',
            'r1',
            invoker,
            'coach',
            false,
        ),
    )

describe('AcceptPersonalTrainingHandler', () => {
    beforeEach(() => {
        jest.useFakeTimers({
            now: NOW,
            doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'queueMicrotask'],
        })
    })
    afterEach(() => jest.useRealTimers())

    it('is NotFound for an unknown request', async () => {
        const { handler, prisma } = build()
        prisma.personalTrainingRequest.findFirst.mockResolvedValue(null)
        await expect(run(handler, 'o1', 'c1')).rejects.toBeInstanceOf(NotFoundError)
    })

    it('is NotFound for a non-participant who is not an admin', async () => {
        const { handler, prisma } = build()
        await expect(run(handler, 'o1', 'stranger')).rejects.toBeInstanceOf(
            NotFoundError,
        )
        expect(prisma.attendanceSession.create).not.toHaveBeenCalled()
    })

    it('is NotFound for an option that is not on the request', async () => {
        const { handler } = build()
        await expect(run(handler, 'nope', 'c1')).rejects.toBeInstanceOf(NotFoundError)
    })

    it('refuses the member while the request is still with the coach', async () => {
        const { handler } = build()
        await expect(run(handler, 'o1', 'm1')).rejects.toBeInstanceOf(ConflictError)
    })

    it('refuses an option whose time has passed', async () => {
        const { handler } = build(
            makeRow({
                options: [
                    option('o1', 'member', '2026-10-24T08:00:00Z', '2026-10-23T08:00:00Z'),
                ],
            }),
        )
        await expect(run(handler, 'o1', 'c1')).rejects.toBeInstanceOf(BadRequestError)
    })

    it('confirms: creates the personal session, flips the status, notifies the member', async () => {
        const { handler, prisma, notifyUser, realtime } = build()
        const out = await run(handler, 'o2', 'c1')

        expect(prisma.attendanceSession.create.mock.calls[0][0].data).toEqual({
            workspaceId: 'w1',
            groupId: null,
            slotId: null,
            // 2026-11-01T03:00Z is 10:00 on the 1st in Tomsk.
            sessionDate: new Date('2026-11-01T00:00:00Z'),
            occurrenceKey: 'personal:r1',
            title: 'Персональная тренировка',
            startAt: new Date('2026-11-01T03:00:00Z'),
            timezone: 'Asia/Tomsk',
            checkInCode: null,
            coachId: 'c1',
            createdById: 'c1',
            isPersonal: true,
        })
        expect(prisma.personalTrainingRequest.updateMany.mock.calls[0][0]).toEqual({
            where: {
                id: 'r1',
                status: 'PENDING_COACH',
                updatedAt: new Date('2026-10-24T08:00:00Z'),
            },
            data: {
                status: 'CONFIRMED',
                confirmedStartAt: new Date('2026-11-01T03:00:00Z'),
                confirmedDurationMin: 60,
                sessionId: 'sess1',
            },
        })
        expect(out).toMatchObject({ status: 'CONFIRMED', sessionId: 'sess1' })
        expect(realtime.invalidateUsers).toHaveBeenCalledWith(
            ['m1', 'c1'],
            ['personal-trainings', 'attendance'],
        )
        expect(notifyUser).toHaveBeenCalledTimes(1)
        expect(notifyUser.mock.calls[0][0]).toMatchObject({
            userId: 'm1',
            kind: 'personal.confirmed',
            refId: 'r1:confirmed:m1',
            topic: 'Персональная тренировка подтверждена',
            message: 'Bob · 01.11 в 10:00 · Манеж',
        })
    })

    it('lets the member confirm the coach\'s latest proposal', async () => {
        const { handler, notifyUser } = build(
            makeRow({
                status: 'PENDING_MEMBER',
                options: [
                    option('o1', 'member', '2026-10-31T12:00:00Z', '2026-10-24T08:00:00Z'),
                    option('o3', 'coach', '2026-11-02T03:00:00Z', '2026-10-24T08:30:00Z'),
                ],
            }),
        )
        await run(handler, 'o3', 'm1')
        expect(notifyUser.mock.calls[0][0]).toMatchObject({
            userId: 'c1',
            refId: 'r1:confirmed:c1',
            message: 'Ann · 02.11 в 10:00 · Манеж',
        })
    })

    it('refuses a stale coach option with a conflict', async () => {
        const { handler } = build(
            makeRow({
                status: 'PENDING_MEMBER',
                options: [
                    option('c1o', 'coach', '2026-11-02T03:00:00Z', '2026-10-24T08:10:00Z'),
                    option('c2o', 'coach', '2026-11-03T03:00:00Z', '2026-10-24T08:20:00Z'),
                ],
            }),
        )
        await expect(run(handler, 'c1o', 'm1')).rejects.toBeInstanceOf(ConflictError)
    })

    it('rolls back with a conflict when the status changed underneath', async () => {
        const { handler, prisma, notifyUser } = build()
        prisma.personalTrainingRequest.updateMany.mockResolvedValue({ count: 0 })
        await expect(run(handler, 'o1', 'c1')).rejects.toBeInstanceOf(ConflictError)
        expect(notifyUser).not.toHaveBeenCalled()
    })

    it('guards on updatedAt: a coach edit after the read is a conflict', async () => {
        const { handler, prisma } = build()
        prisma.personalTrainingRequest.updateMany.mockResolvedValue({ count: 0 })
        await expect(run(handler, 'o1', 'c1')).rejects.toThrow(
            'Статус заявки изменился — обновите экран',
        )
        expect(
            prisma.personalTrainingRequest.updateMany.mock.calls[0][0].where
                .updatedAt,
        ).toEqual(new Date('2026-10-24T08:00:00Z'))
    })

    it('maps a double accept (P2002 on the session) to the same conflict', async () => {
        const { handler, prisma, notifyUser } = build()
        prisma.attendanceSession.create.mockRejectedValue({ code: 'P2002' })
        const err = await run(handler, 'o1', 'c1').catch((e) => e)
        expect(err).toBeInstanceOf(ConflictError)
        expect(err.message).toBe('Статус заявки изменился — обновите экран')
        expect(prisma.personalTrainingRequest.updateMany).not.toHaveBeenCalled()
        expect(notifyUser).not.toHaveBeenCalled()
    })

    it('lets an admin confirm on the coach\'s behalf and tells both sides', async () => {
        const { handler, notifyUser } = build(makeRow(), true)
        await run(handler, 'o1', 'admin1')
        expect(notifyUser.mock.calls.map((c) => c[0].refId)).toEqual([
            'r1:confirmed:m1',
            'r1:confirmed:c1',
        ])
    })

    it('still succeeds when the notification fails', async () => {
        const { handler, notifyUser } = build()
        notifyUser.mockRejectedValue(new Error('push down'))
        await expect(run(handler, 'o1', 'c1')).resolves.toMatchObject({
            status: 'CONFIRMED',
        })
    })
})
