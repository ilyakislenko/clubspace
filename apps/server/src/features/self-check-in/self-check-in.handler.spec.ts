import { syncFirstVisitStartInTx } from '../../domains/subscriptions/first-visit-start'
import {
    BadRequestError,
    ForbiddenError,
} from '../../shared/errors/shared.errors'
import { SelfCheckInFeature } from './self-check-in.feature'
import { SelfCheckInHandler } from './self-check-in.handler'

jest.mock('../../domains/subscriptions/first-visit-start', () => ({
    syncFirstVisitStartInTx: jest.fn().mockResolvedValue('unchanged'),
}))

beforeEach(() => (syncFirstVisitStartInTx as jest.Mock).mockClear())

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
    p.$executeRaw = jest.fn().mockResolvedValue(0)
    p.$transaction = jest.fn(async (fn: (t: unknown) => unknown) => fn(p))
    return p
}

const followUps = { schedule: jest.fn() }
const realtime = {
    invalidateCoalesced: jest.fn(),
    invalidateUsersInWorkspace: jest.fn(),
}
const leaderboard = { invalidate: jest.fn().mockResolvedValue(undefined) }

beforeEach(() => {
    followUps.schedule.mockClear()
    realtime.invalidateCoalesced.mockClear()
    realtime.invalidateUsersInWorkspace.mockClear()
    leaderboard.invalidate.mockClear()
})

const run = (prisma: unknown, code = 'ABC234') =>
    new SelfCheckInHandler(
        prisma as never,
        realtime as never,
        followUps as never,
        leaderboard as never,
    ).execute(new SelfCheckInFeature({ code }, 'w1', 'u1'))

describe('selfCheckIn', () => {
    it('starts a first-visit abonement from the check-in', async () => {
        const prisma = makePrisma({
            membership: {
                status: 'ACTIVE',
                subscription: {
                    id: 'sub1',
                    classesRemaining: null,
                    startsOnFirstVisit: true,
                    status: 'ACTIVE',
                    endDate: null,
                },
            },
        })
        await run(prisma)
        expect(syncFirstVisitStartInTx).toHaveBeenCalledWith(prisma, {
            workspaceId: 'w1',
            userId: 'u1',
            now: expect.any(Date),
        })
    })

    it('leaves an ordinary abonement alone', async () => {
        await run(makePrisma({}))
        expect(syncFirstVisitStartInTx).not.toHaveBeenCalled()
    })

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
            /Абонемент заморожен по 30 октября\. Чтобы отметиться, попросите тренера или администратора клуба снять заморозку\./,
        )
        expect(prisma.$transaction).not.toHaveBeenCalled()
        expect(prisma.attendanceRecord.createMany).not.toHaveBeenCalled()
        expect(prisma.subscriptionFreeze.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ subscriptionId: 'sub1' }),
            }),
        )
    })

    it("checks the freeze on the session's day in the club timezone, not today", async () => {
        const prisma = makePrisma({})
        await run(prisma)
        // 18:00Z on 2026-07-20 is 21:00 Moscow, still the 20th.
        expect(prisma.subscriptionFreeze.findFirst).toHaveBeenCalledWith({
            where: {
                subscriptionId: 'sub1',
                fromDate: { lte: new Date('2026-07-20T00:00:00Z') },
                untilDate: { gte: new Date('2026-07-20T00:00:00Z') },
            },
        })
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

    it('never matches a personal session', async () => {
        const prisma = makePrisma({})
        await run(prisma)
        expect(
            prisma.attendanceSession.findFirst.mock.calls[0][0].where.isPersonal,
        ).toBe(false)
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

    it('hands the pack alert to the after-commit follow-up when a class was drawn', async () => {
        const prisma = makePrisma({ membership: packMembership(2) })
        await run(prisma)
        expect(followUps.schedule).toHaveBeenCalledWith({
            workspaceId: 'w1',
            userIds: ['u1'],
            subscriptionIds: ['sub1'],
        })
        expect(leaderboard.invalidate).toHaveBeenCalledWith('w1')
        expect(realtime.invalidateCoalesced).toHaveBeenCalledWith('w1', [
            'attendance',
            'leaderboard',
        ])
        expect(realtime.invalidateUsersInWorkspace).toHaveBeenCalledWith(
            ['u1'],
            'w1',
            ['attendance', 'subscription'],
        )
    })

    it('reports 0 left after the last class is used', async () => {
        const prisma = makePrisma({ membership: packMembership(1) })
        const res = await run(prisma)
        expect(res.classesRemaining).toBe(0)
        expect(followUps.schedule).toHaveBeenCalledWith(
            expect.objectContaining({ subscriptionIds: ['sub1'] }),
        )
    })

    it('schedules no pack alert when nothing was deducted', async () => {
        await run(makePrisma({ membership: packMembership(0) }))
        await run(
            makePrisma({ membership: { status: 'ACTIVE', subscription: null } }),
        )
        for (const [job] of followUps.schedule.mock.calls) {
            expect(job.subscriptionIds).toEqual([])
        }
    })

    it('does nothing after the transaction when already checked in', async () => {
        await run(makePrisma({ alreadyPresent: true }))
        expect(followUps.schedule).not.toHaveBeenCalled()
        expect(leaderboard.invalidate).not.toHaveBeenCalled()
        expect(realtime.invalidateCoalesced).not.toHaveBeenCalled()
    })

    it('does not tag the check-in when a concurrent one took the last class', async () => {
        const prisma = makePrisma({ membership: packMembership(1) })
        // The guarded decrement found the pack already at 0.
        prisma.subscription.updateMany.mockResolvedValue({ count: 0 })
        const res = await run(prisma)
        expect(res.checkedIn).toBe(true)
        expect(res.classesRemaining).toBe(0)
        // No tag → an un-mark won't refund a class this check-in never drew.
        expect(prisma.attendanceRecord.updateMany).not.toHaveBeenCalled()
        expect(followUps.schedule).toHaveBeenCalledWith(
            expect.objectContaining({ subscriptionIds: [] }),
        )
    })

    it('refreshes lastAttendedAt on a check-in, not on a repeat', async () => {
        const prisma = makePrisma({})
        await run(prisma)
        expect(prisma.$executeRaw.mock.calls[0].slice(1)).toEqual(['w1', ['u1']])

        const repeat = makePrisma({ alreadyPresent: true })
        await run(repeat)
        expect(repeat.$executeRaw).not.toHaveBeenCalled()
    })
})
