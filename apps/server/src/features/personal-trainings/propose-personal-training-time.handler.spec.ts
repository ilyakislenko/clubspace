import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { ProposePersonalTrainingTimeFeature } from './propose-personal-training-time.feature'
import { ProposePersonalTrainingTimeHandler } from './propose-personal-training-time.handler'

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

const makePrisma = (row = makeRow()) => {
    const p: any = {
        personalTrainingRequest: {
            findFirst: jest.fn().mockResolvedValue(row),
            findUniqueOrThrow: jest
                .fn()
                .mockResolvedValue({ ...row, status: 'PENDING_MEMBER' }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        personalTrainingOption: {
            create: jest.fn().mockResolvedValue({ id: 'opt-new' }),
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
    const handler = new ProposePersonalTrainingTimeHandler(
        prisma as never,
        makeRbac(admin) as never,
        { notifyUser } as never,
        realtime as never,
    )
    return { handler, prisma, notifyUser, realtime }
}

const run = (
    handler: ProposePersonalTrainingTimeHandler,
    invoker: string,
    over: Record<string, unknown> = {},
) =>
    handler.execute(
        new ProposePersonalTrainingTimeFeature(
            { startAt: '2026-11-02T10:00', durationMin: 90, ...over },
            'w1',
            'r1',
            invoker,
            'coach',
            false,
        ),
    )

describe('ProposePersonalTrainingTimeHandler', () => {
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
        await expect(run(a.handler, 'c1')).rejects.toBeInstanceOf(NotFoundError)
        const b = build()
        await expect(run(b.handler, 'stranger')).rejects.toBeInstanceOf(NotFoundError)
    })

    it('forbids the member', async () => {
        const { handler } = build()
        await expect(run(handler, 'm1')).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('refuses a confirmed or closed request', async () => {
        for (const status of ['CONFIRMED', 'DECLINED', 'CANCELLED']) {
            const { handler } = build(makeRow({ status }))
            await expect(run(handler, 'c1')).rejects.toBeInstanceOf(ConflictError)
        }
    })

    it('refuses a time in the past', async () => {
        const { handler, prisma } = build()
        await expect(
            run(handler, 'c1', { startAt: '2026-10-24T10:00' }),
        ).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.personalTrainingOption.create).not.toHaveBeenCalled()
    })

    it('adds a coach option, hands the request to the member and notifies them', async () => {
        const { handler, prisma, notifyUser, realtime } = build()
        const out = await run(handler, 'c1', { comment: 'Удобнее позже' })
        expect(prisma.personalTrainingOption.create.mock.calls[0][0].data).toEqual({
            requestId: 'r1',
            startAt: new Date('2026-11-02T03:00:00Z'),
            durationMin: 90,
            proposedBy: 'coach',
        })
        expect(prisma.personalTrainingRequest.updateMany.mock.calls[0][0]).toEqual({
            where: { id: 'r1', status: 'PENDING_COACH' },
            data: { status: 'PENDING_MEMBER', coachComment: 'Удобнее позже' },
        })
        expect(out.status).toBe('PENDING_MEMBER')
        expect(realtime.invalidateUsers).toHaveBeenCalledWith(
            ['m1', 'c1'],
            ['personal-trainings'],
        )
        expect(notifyUser).toHaveBeenCalledTimes(1)
        expect(notifyUser.mock.calls[0][0]).toMatchObject({
            userId: 'm1',
            kind: 'personal.proposed',
            refId: 'opt-new:m1',
            topic: 'Тренер предложил другое время',
            message: 'Bob: 02.11 в 10:00. Подтвердите или откажитесь в приложении.',
        })
    })

    it('stores a blank comment as null and allows re-proposing from PENDING_MEMBER', async () => {
        const { handler, prisma } = build(makeRow({ status: 'PENDING_MEMBER' }))
        await run(handler, 'c1', { comment: '' })
        expect(prisma.personalTrainingRequest.updateMany.mock.calls[0][0]).toEqual({
            where: { id: 'r1', status: 'PENDING_MEMBER' },
            data: { status: 'PENDING_MEMBER', coachComment: null },
        })
    })

    it('rolls back with a conflict when the status changed underneath', async () => {
        const { handler, prisma, notifyUser } = build()
        prisma.personalTrainingRequest.updateMany.mockResolvedValue({ count: 0 })
        await expect(run(handler, 'c1')).rejects.toBeInstanceOf(ConflictError)
        expect(notifyUser).not.toHaveBeenCalled()
    })

    it('lets an admin propose for the coach and tells both sides', async () => {
        const { handler, notifyUser } = build(makeRow(), true)
        await run(handler, 'admin1')
        expect(notifyUser.mock.calls.map((c) => c[0].refId)).toEqual([
            'opt-new:m1',
            'opt-new:c1',
        ])
        expect(notifyUser.mock.calls.map((c) => c[0].topic)).toEqual([
            'Клуб предложил другое время',
            'Администратор предложил другое время',
        ])
    })
})
