import {
    BadRequestError,
    ForbiddenError,
} from '../../shared/errors/shared.errors'
import { SelfCheckInFeature } from './self-check-in.feature'
import { SelfCheckInHandler } from './self-check-in.handler'

const makePrisma = (opts: {
    session?: unknown
    membership?: unknown
    inGroup?: boolean
    alreadyPresent?: boolean
}) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = {
        attendanceSession: {
            findFirst: jest.fn().mockResolvedValue(
                'session' in opts
                    ? opts.session
                    : {
                          id: 's1',
                          title: 'Вечерняя',
                          startAt: new Date('2026-07-20T18:00:00Z'),
                          groupId: 'g1',
                      },
            ),
        },
        workspaceMember: {
            findFirst: jest.fn().mockResolvedValue(
                'membership' in opts
                    ? opts.membership
                    : {
                          status: 'ACTIVE',
                          subscription: { id: 'sub1', classesRemaining: 3 },
                      },
            ),
        },
        groupMember: {
            findFirst: jest
                .fn()
                .mockResolvedValue(opts.inGroup === false ? null : { userId: 'u1' }),
        },
        attendanceRecord: {
            createMany: jest
                .fn()
                .mockResolvedValue({ count: opts.alreadyPresent ? 0 : 1 }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        subscription: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
    }
    p.$transaction = jest.fn(async (fn: (t: unknown) => unknown) => fn(p))
    return p
}

const run = (prisma: unknown, code = 'ABC234') =>
    new SelfCheckInHandler(
        prisma as never,
        {
            invalidate: jest.fn(),
            invalidateUsers: jest.fn(),
        } as never,
        { notifyUnlocked: jest.fn().mockResolvedValue(undefined) } as never,
    ).execute(new SelfCheckInFeature({ code }, 'w1', 'u1'))

describe('selfCheckIn', () => {
    it('checks a member in and deducts one class from their pack', async () => {
        const prisma = makePrisma({})
        const res = await run(prisma)
        expect(prisma.attendanceRecord.createMany).toHaveBeenCalled()
        expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
            where: { id: 'sub1', classesRemaining: { gt: 0 } },
            data: { classesRemaining: { decrement: 1 } },
        })
        expect(prisma.attendanceRecord.updateMany).toHaveBeenCalledWith({
            where: { sessionId: 's1', userId: 'u1' },
            data: { consumedSubscriptionId: 'sub1' },
        })
        expect(res).toMatchObject({
            sessionId: 's1',
            checkedIn: true,
            classesRemaining: 2,
        })
    })

    it('uppercases the code before lookup', async () => {
        const prisma = makePrisma({})
        await run(prisma, 'abc234')
        expect(
            prisma.attendanceSession.findFirst.mock.calls[0][0].where.checkInCode,
        ).toBe('ABC234')
    })

    it('rejects an unknown / expired code', async () => {
        const prisma = makePrisma({ session: null })
        await expect(run(prisma)).rejects.toBeInstanceOf(BadRequestError)
    })

    it('forbids a non-active member', async () => {
        const prisma = makePrisma({
            membership: { status: 'SUSPENDED', subscription: null },
        })
        await expect(run(prisma)).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('is a no-op deduction when already checked in', async () => {
        const prisma = makePrisma({ alreadyPresent: true })
        const res = await run(prisma)
        expect(res.checkedIn).toBe(false)
        expect(prisma.subscription.updateMany).not.toHaveBeenCalled()
    })

    it('does not deduct when the member has no class-pack', async () => {
        const prisma = makePrisma({
            membership: { status: 'ACTIVE', subscription: null },
        })
        const res = await run(prisma)
        expect(res.checkedIn).toBe(true)
        expect(res.classesRemaining).toBeNull()
        expect(prisma.subscription.updateMany).not.toHaveBeenCalled()
    })

    it('marks a non-group member as a guest', async () => {
        const prisma = makePrisma({ inGroup: false })
        await run(prisma)
        const rows = prisma.attendanceRecord.createMany.mock.calls[0][0].data
        expect(rows[0].isGuest).toBe(true)
    })
})
