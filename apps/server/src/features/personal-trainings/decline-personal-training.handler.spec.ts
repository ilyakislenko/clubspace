import {
    BadRequestError,
    ConflictError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { DeclinePersonalTrainingFeature } from './decline-personal-training.feature'
import { DeclinePersonalTrainingHandler } from './decline-personal-training.handler'

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
    options: [],
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

const makePrisma = (row = makeRow()) => ({
    personalTrainingRequest: {
        findFirst: jest.fn().mockResolvedValue(row),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ ...row, status: 'DECLINED' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
})

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
    const handler = new DeclinePersonalTrainingHandler(
        prisma as never,
        makeRbac(admin) as never,
        { notifyUser } as never,
        realtime as never,
    )
    return { handler, prisma, notifyUser, realtime }
}

const run = (
    handler: DeclinePersonalTrainingHandler,
    invoker: string,
    comment?: string,
) =>
    handler.execute(
        new DeclinePersonalTrainingFeature(
            { comment },
            'w1',
            'r1',
            invoker,
            'coach',
            false,
        ),
    )

describe('DeclinePersonalTrainingHandler', () => {
    it('is NotFound for an unknown request and for a stranger', async () => {
        const a = build()
        a.prisma.personalTrainingRequest.findFirst.mockResolvedValue(null)
        await expect(run(a.handler, 'c1')).rejects.toBeInstanceOf(NotFoundError)
        const b = build()
        await expect(run(b.handler, 'stranger')).rejects.toBeInstanceOf(NotFoundError)
    })

    it('tells a member to cancel rather than decline their own request', async () => {
        const { handler, prisma } = build()
        await expect(run(handler, 'm1')).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.personalTrainingRequest.updateMany).not.toHaveBeenCalled()
    })

    it('tells a coach to cancel rather than decline their own proposal', async () => {
        const { handler } = build(makeRow({ status: 'PENDING_MEMBER' }))
        await expect(run(handler, 'c1')).rejects.toBeInstanceOf(BadRequestError)
    })

    it('refuses a closed request', async () => {
        const { handler } = build(makeRow({ status: 'DECLINED' }))
        await expect(run(handler, 'c1')).rejects.toBeInstanceOf(ConflictError)
    })

    it('the coach declines with a reason and the member hears it', async () => {
        const { handler, prisma, notifyUser, realtime } = build()
        const out = await run(handler, 'c1', 'Занят в эти дни')
        expect(prisma.personalTrainingRequest.updateMany.mock.calls[0][0]).toEqual({
            where: { id: 'r1', status: 'PENDING_COACH' },
            data: {
                status: 'DECLINED',
                closedByRole: 'coach',
                closeComment: 'Занят в эти дни',
            },
        })
        expect(out.status).toBe('DECLINED')
        expect(realtime.invalidateUsers).toHaveBeenCalledWith(
            ['m1', 'c1'],
            ['personal-trainings'],
        )
        expect(notifyUser).toHaveBeenCalledTimes(1)
        expect(notifyUser.mock.calls[0][0]).toMatchObject({
            userId: 'm1',
            kind: 'personal.declined',
            refId: 'r1:declined:m1',
            topic: 'Заявка отклонена',
            message: 'Bob: «Занят в эти дни»',
        })
    })

    it('the member declines the coach\'s proposal; blank comment becomes null', async () => {
        const { handler, prisma, notifyUser } = build(
            makeRow({ status: 'PENDING_MEMBER' }),
        )
        await run(handler, 'm1', '')
        expect(prisma.personalTrainingRequest.updateMany.mock.calls[0][0].data).toEqual({
            status: 'DECLINED',
            closedByRole: 'member',
            closeComment: null,
        })
        expect(notifyUser.mock.calls[0][0]).toMatchObject({
            userId: 'c1',
            refId: 'r1:declined:c1',
            topic: 'Ученик не принял предложенное время',
            message: 'Ann',
        })
    })

    it('conflicts when the status changed underneath', async () => {
        const { handler, prisma, notifyUser } = build()
        prisma.personalTrainingRequest.updateMany.mockResolvedValue({ count: 0 })
        await expect(run(handler, 'c1')).rejects.toBeInstanceOf(ConflictError)
        expect(notifyUser).not.toHaveBeenCalled()
    })

    it('lets an admin decline as the coach', async () => {
        const { handler, prisma, notifyUser } = build(makeRow(), true)
        await run(handler, 'admin1')
        expect(prisma.personalTrainingRequest.updateMany.mock.calls[0][0].data.closedByRole).toBe('coach')
        expect(notifyUser.mock.calls.map((c) => c[0].refId)).toEqual([
            'r1:declined:m1',
            'r1:declined:c1',
        ])
    })

    it('still succeeds when the notification fails', async () => {
        const { handler, notifyUser } = build()
        notifyUser.mockRejectedValue(new Error('push down'))
        await expect(run(handler, 'c1')).resolves.toMatchObject({ status: 'DECLINED' })
    })
})
