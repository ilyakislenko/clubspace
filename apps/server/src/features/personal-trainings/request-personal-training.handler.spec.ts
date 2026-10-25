import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RequestPersonalTrainingFeature } from './request-personal-training.feature'
import { RequestPersonalTrainingHandler } from './request-personal-training.handler'

// Saturday 2026-10-24 09:00Z.
const NOW = new Date('2026-10-24T09:00:00Z')

const person = (id: string, firstname: string) => ({
    id,
    firstname,
    lastname: null,
    email: `${id}@x`,
})

const makePrisma = () => ({
    personalTrainingCoach: {
        findMany: jest.fn().mockResolvedValue([
            { userId: 'c1', user: { firstname: 'Bob', lastname: null, email: 'c1@x' } },
        ]),
    },
    workspace: {
        findUnique: jest
            .fn()
            .mockResolvedValue({ ownerId: 'owner', timezone: 'Europe/Moscow' }),
    },
    workspaceMember: {
        findMany: jest
            .fn()
            .mockResolvedValue([{ userId: 'c1', role: { name: 'coach' } }]),
    },
    gym: {
        findFirst: jest.fn().mockResolvedValue({ timezone: 'Asia/Tomsk' }),
    },
    personalTrainingRequest: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(async ({ data }) => ({
            id: 'r1',
            workspaceId: data.workspaceId,
            status: 'PENDING_COACH',
            memberId: data.memberId,
            coachId: data.coachId,
            member: person('m1', 'Ann'),
            coach: person('c1', 'Bob'),
            gym: null,
            timezone: data.timezone,
            options: data.options.create.map((o: object, i: number) => ({
                id: `o${i}`,
                createdAt: NOW,
                ...o,
            })),
            confirmedStartAt: null,
            confirmedDurationMin: null,
            sessionId: null,
            memberComment: data.memberComment,
            coachComment: null,
            closeComment: null,
            closedByRole: null,
            createdAt: NOW,
            updatedAt: NOW,
        })),
    },
})

const build = () => {
    const prisma = makePrisma()
    const notifyUser = jest.fn().mockResolvedValue(true)
    const realtime = { invalidateUsers: jest.fn() }
    const handler = new RequestPersonalTrainingHandler(
        prisma as never,
        { notifyUser } as never,
        realtime as never,
    )
    return { handler, prisma, notifyUser, realtime }
}

const input = (over: Record<string, unknown> = {}) => ({
    coachId: 'c1',
    options: [
        { startAt: '2026-10-31T19:00', durationMin: 60 },
        { startAt: '2026-11-01T10:00', durationMin: 90 },
    ],
    ...over,
})

const run = (
    handler: RequestPersonalTrainingHandler,
    over: Record<string, unknown> = {},
    invoker = 'm1',
) =>
    handler.execute(
        new RequestPersonalTrainingFeature(input(over) as never, 'w1', invoker),
    )

describe('RequestPersonalTrainingHandler', () => {
    beforeEach(() => {
        jest.useFakeTimers({
            now: NOW,
            doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'queueMicrotask'],
        })
    })
    afterEach(() => jest.useRealTimers())

    it('refuses a request to yourself', async () => {
        const { handler, prisma } = build()
        await expect(run(handler, { coachId: 'm1' })).rejects.toBeInstanceOf(
            BadRequestError,
        )
        expect(prisma.personalTrainingRequest.create).not.toHaveBeenCalled()
    })

    it('is NotFound for a coach who did not opt in', async () => {
        const { handler, prisma } = build()
        prisma.personalTrainingCoach.findMany.mockResolvedValue([])
        await expect(run(handler)).rejects.toBeInstanceOf(NotFoundError)
    })

    it('is NotFound for a demoted coach whose stale offer row remains', async () => {
        const { handler, prisma } = build()
        prisma.workspaceMember.findMany.mockResolvedValue([
            { userId: 'c1', role: { name: 'user' } },
        ])
        await expect(run(handler)).rejects.toBeInstanceOf(NotFoundError)
    })

    it('only admits coaches whose membership is active and not expired', async () => {
        const { handler, prisma } = build()
        await run(handler)
        expect(prisma.workspaceMember.findMany.mock.calls[0][0].where).toMatchObject({
            workspaceId: 'w1',
            status: 'ACTIVE',
            OR: [{ accessUntil: null }, { accessUntil: { gte: expect.any(Date) } }],
        })
    })

    it('admits the owner, who has no member row', async () => {
        const { handler, prisma } = build()
        prisma.personalTrainingCoach.findMany.mockResolvedValue([
            { userId: 'owner', user: { firstname: 'Own', lastname: null, email: 'o@x' } },
        ])
        prisma.workspaceMember.findMany.mockResolvedValue([])
        await expect(run(handler, { coachId: 'owner' })).resolves.toMatchObject({
            coach: { userId: 'owner' },
        })
    })

    it('is NotFound for a gym outside the club', async () => {
        const { handler, prisma } = build()
        prisma.gym.findFirst.mockResolvedValue(null)
        await expect(
            run(handler, { gymId: '0b6f3c1e-0000-4000-8000-000000000001' }),
        ).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.gym.findFirst.mock.calls[0][0].where).toEqual({
            id: '0b6f3c1e-0000-4000-8000-000000000001',
            workspaceId: 'w1',
        })
    })

    it('refuses a fourth open request', async () => {
        const { handler, prisma } = build()
        prisma.personalTrainingRequest.count.mockResolvedValue(3)
        await expect(run(handler)).rejects.toThrow(
            'У вас уже 3 активные заявки — дождитесь ответа или отмените одну из них',
        )
        // Derived-expired requests (no option left in the future) don't count.
        expect(prisma.personalTrainingRequest.count.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            memberId: 'm1',
            status: { in: ['PENDING_COACH', 'PENDING_MEMBER'] },
            options: { some: { startAt: { gt: expect.any(Date) } } },
        })
    })

    it('refuses past, duplicate and too-distant times', async () => {
        const { handler } = build()
        await expect(
            run(handler, { options: [{ startAt: '2026-10-24T10:00', durationMin: 60 }] }),
        ).rejects.toThrow(/в будущем/)
        await expect(
            run(handler, {
                options: [
                    { startAt: '2026-10-31T19:00', durationMin: 60 },
                    { startAt: '2026-10-31T19:00', durationMin: 90 },
                ],
            }),
        ).rejects.toThrow(/не должны совпадать/)
        await expect(
            run(handler, { options: [{ startAt: '2027-03-01T10:00', durationMin: 60 }] }),
        ).rejects.toThrow(/90 дней/)
    })

    it('creates the request in the club zone and notifies only the coach', async () => {
        const { handler, prisma, notifyUser, realtime } = build()
        const out = await run(handler, { comment: 'Хочу отработать пассы' })
        const data = prisma.personalTrainingRequest.create.mock.calls[0][0].data
        expect(data).toMatchObject({
            workspaceId: 'w1',
            memberId: 'm1',
            coachId: 'c1',
            gymId: null,
            timezone: 'Europe/Moscow',
            memberComment: 'Хочу отработать пассы',
        })
        expect(data.options.create).toEqual([
            { startAt: new Date('2026-10-31T16:00:00Z'), durationMin: 60, proposedBy: 'member' },
            { startAt: new Date('2026-11-01T07:00:00Z'), durationMin: 90, proposedBy: 'member' },
        ])
        expect(out).toMatchObject({ id: 'r1', status: 'PENDING_COACH', displayStatus: 'PENDING_COACH' })
        expect(realtime.invalidateUsers).toHaveBeenCalledWith(
            ['m1', 'c1'],
            ['personal-trainings'],
        )
        expect(notifyUser).toHaveBeenCalledTimes(1)
        expect(notifyUser.mock.calls[0][0]).toMatchObject({
            userId: 'c1',
            kind: 'personal.requested',
            refId: 'r1:requested:c1',
            topic: 'Новая заявка на персональную тренировку',
            message: 'Ann предлагает: 31.10 в 19:00 и ещё 1 вариант',
            metadata: { requestId: 'r1' },
            workspaceId: 'w1',
        })
    })

    it('uses the gym zone when a gym is chosen', async () => {
        const { handler, prisma } = build()
        await run(handler, {
            gymId: '0b6f3c1e-0000-4000-8000-000000000001',
            options: [{ startAt: '2026-10-31T19:00', durationMin: 60 }],
        })
        const data = prisma.personalTrainingRequest.create.mock.calls[0][0].data
        expect(data.timezone).toBe('Asia/Tomsk')
        expect(data.gymId).toBe('0b6f3c1e-0000-4000-8000-000000000001')
        expect(data.options.create[0].startAt).toEqual(new Date('2026-10-31T12:00:00Z'))
    })

    it('still succeeds when the notification fails', async () => {
        const { handler, notifyUser } = build()
        notifyUser.mockRejectedValue(new Error('push down'))
        await expect(run(handler)).resolves.toMatchObject({ id: 'r1' })
    })
})
