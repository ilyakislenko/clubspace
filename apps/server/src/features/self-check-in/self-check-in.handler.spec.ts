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
    frozenUntil?: Date
}) => {
    const membership =
        'membership' in opts
            ? opts.membership
            : {
                  status: 'ACTIVE',
                  subscription: {
                      id: 'sub1',
                      classesRemaining: 3,
                      status: 'ACTIVE',
                      endDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
                  },
              }
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
                membership && {
                    workspace: { timezone: 'Europe/Moscow' },
                    ...(membership as object),
                },
            ),
        },
        subscriptionFreeze: {
            findFirst: jest
                .fn()
                .mockResolvedValue(
                    opts.frozenUntil ? { untilDate: opts.frozenUntil } : null,
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

const classPacks = { notifyLowOrExhausted: jest.fn().mockResolvedValue(undefined) }

beforeEach(() => classPacks.notifyLowOrExhausted.mockClear())

const run = (prisma: unknown, code = 'ABC234') =>
    new SelfCheckInHandler(
        prisma as never,
        {
            invalidate: jest.fn(),
            invalidateUsers: jest.fn(),
        } as never,
        { notifyUnlocked: jest.fn().mockResolvedValue(undefined) } as never,
        classPacks as never,
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

    // The membership keeps pointing at a pack after it dies, so self check-in
    // used to burn a class the member could never spend.
    it('does not deduct from an expired pack, and still checks in', async () => {
        const prisma = makePrisma({
            membership: {
                status: 'ACTIVE',
                subscription: {
                    id: 'sub1',
                    classesRemaining: 3,
                    status: 'ACTIVE',
                    endDate: new Date(Date.now() - 24 * 3600 * 1000),
                },
            },
        })
        const res = await run(prisma)
        expect(prisma.attendanceRecord.createMany).toHaveBeenCalled()
        expect(prisma.subscription.updateMany).not.toHaveBeenCalled()
        expect(res).toMatchObject({ checkedIn: true, classesRemaining: null })
    })

    it('does not deduct from a cancelled pack', async () => {
        const prisma = makePrisma({
            membership: {
                status: 'ACTIVE',
                subscription: {
                    id: 'sub1',
                    classesRemaining: 3,
                    status: 'CANCELLED',
                    endDate: new Date(Date.now() + 24 * 3600 * 1000),
                },
            },
        })
        await run(prisma)
        expect(prisma.subscription.updateMany).not.toHaveBeenCalled()
    })

    it('refuses a frozen abonement before writing anything', async () => {
        const prisma = makePrisma({
            frozenUntil: new Date('2026-10-30T00:00:00Z'),
        })
        await expect(run(prisma)).rejects.toThrow(
            /Абонемент заморожен по 30 октября\. Чтобы отметиться, попросите администратора клуба снять заморозку/,
        )
        expect(prisma.$transaction).not.toHaveBeenCalled()
        expect(prisma.attendanceRecord.createMany).not.toHaveBeenCalled()
        expect(prisma.subscriptionFreeze.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ subscriptionId: 'sub1' }),
            }),
        )
    })

    it('does not look for a freeze when the member has no usable abonement', async () => {
        const prisma = makePrisma({
            membership: { status: 'ACTIVE', subscription: null },
        })
        await run(prisma)
        expect(prisma.subscriptionFreeze.findFirst).not.toHaveBeenCalled()
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

    const packMembership = (classesRemaining: number) => ({
        status: 'ACTIVE',
        subscription: {
            id: 'sub1',
            classesRemaining,
            status: 'ACTIVE',
            endDate: new Date(Date.now() + 24 * 3600 * 1000),
        },
    })

    it('notifies the pack after a check-in leaves 1 class', async () => {
        const prisma = makePrisma({ membership: packMembership(2) })
        await run(prisma)
        expect(classPacks.notifyLowOrExhausted).toHaveBeenCalledWith(
            ['sub1'],
            'w1',
        )
    })

    it('notifies the pack after the last class is used', async () => {
        const prisma = makePrisma({ membership: packMembership(1) })
        const res = await run(prisma)
        expect(res.classesRemaining).toBe(0)
        expect(classPacks.notifyLowOrExhausted).toHaveBeenCalledWith(
            ['sub1'],
            'w1',
        )
    })

    it('does not notify when nothing was deducted', async () => {
        await run(makePrisma({ alreadyPresent: true }))
        await run(makePrisma({ membership: packMembership(0) }))
        await run(
            makePrisma({ membership: { status: 'ACTIVE', subscription: null } }),
        )
        expect(classPacks.notifyLowOrExhausted).not.toHaveBeenCalled()
    })

    it('still checks in when the pack notifier fails', async () => {
        classPacks.notifyLowOrExhausted.mockRejectedValueOnce(new Error('boom'))
        const res = await run(makePrisma({ membership: packMembership(1) }))
        expect(res.checkedIn).toBe(true)
    })
})
