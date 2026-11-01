import { syncFirstVisitStartInTx } from '../../domains/subscriptions/first-visit-start'
import {
    BadRequestError,
    ForbiddenError,
} from '../../shared/errors/shared.errors'
import { syncLastAttendedAt } from '../attendance/last-attended'
import { SelfCheckInFeature } from './self-check-in.feature'
import { SelfCheckInHandler } from './self-check-in.handler'

jest.mock('../../domains/subscriptions/first-visit-start', () => ({
    syncFirstVisitStartInTx: jest.fn().mockResolvedValue('unchanged'),
}))
// Own unit (last-attended.spec.ts); kept off the shared $executeRaw mock.
jest.mock('../attendance/last-attended', () => ({ syncLastAttendedAt: jest.fn() }))

beforeEach(() => {
    ;(syncFirstVisitStartInTx as jest.Mock).mockClear()
    ;(syncLastAttendedAt as jest.Mock).mockClear()
})

const LIVE = new Date(Date.now() + 30 * 24 * 3600 * 1000)

// A current abonement of u1 as loadVisitCandidates reads it.
const sub = (
    id: string,
    over: {
        classesTotal?: number | null
        classesRemaining?: number | null
        directions?: string[]
        frozen?: boolean
        status?: string
        endDate?: Date | null
        startsOnFirstVisit?: boolean
    } = {},
) => ({
    id,
    status: over.status ?? 'ACTIVE',
    startDate: null,
    endDate: over.endDate === undefined ? LIVE : over.endDate,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    classesTotal: over.classesTotal === undefined ? 10 : over.classesTotal,
    classesRemaining:
        over.classesRemaining === undefined ? 3 : over.classesRemaining,
    startsOnFirstVisit: over.startsOnFirstVisit ?? false,
    plan: { name: `Plan ${id}` },
    workspaceMember: { userId: 'u1' },
    directions: (over.directions ?? []).map((d) => ({
        directionId: d,
        direction: { id: d, name: d, color: null, icon: null },
    })),
    freezes: over.frozen ? [{ id: 'fr' }] : [],
})

const makePrisma = (opts: {
    session?: unknown
    status?: string | null
    subs?: unknown[]
    direction?: string | null
    inGroup?: boolean
    alreadyPresent?: boolean
    frozenUntil?: Date
    // What a repeat scan finds the earlier check-in was spent on.
    usedRow?: unknown
} = {}) => {
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
            findUnique: jest.fn().mockResolvedValue({
                group: { directionId: opts.direction ?? null },
                workspaceEvent: null,
            }),
        },
        workspaceMember: {
            findFirst: jest.fn().mockResolvedValue(
                opts.status === null
                    ? null
                    : {
                          status: opts.status ?? 'ACTIVE',
                          workspace: { timezone: 'Europe/Moscow' },
                      },
            ),
        },
        subscription: {
            findMany: jest.fn(async ({ where }: { where: { id?: unknown } }) =>
                where.id ? (opts.usedRow ? [opts.usedRow] : []) : (opts.subs ?? [sub('sub1')]),
            ),
            updateManyAndReturn: jest.fn(
                async ({ where }: { where: { id: { in: string[] } } }) =>
                    where.id.in.map((id) => ({ id, classesRemaining: 2 })),
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
        classBooking: {
            findMany: jest.fn().mockResolvedValue([]),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        attendanceRecord: {
            createMany: jest
                .fn()
                .mockResolvedValue({ count: opts.alreadyPresent ? 0 : 1 }),
            findUnique: jest.fn().mockResolvedValue(
                opts.alreadyPresent
                    ? { usedSubscriptionId: opts.usedRow ? 'sub1' : null }
                    : null,
            ),
        },
    }
    p.$executeRaw = jest.fn().mockResolvedValue(1)
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

const run = (prisma: unknown, code = 'ABC234', subscriptionId?: string) =>
    new SelfCheckInHandler(
        prisma as never,
        realtime as never,
        followUps as never,
        leaderboard as never,
    ).execute(new SelfCheckInFeature({ code, subscriptionId }, 'w1', 'u1'))

// [userId, usedSubscriptionId, consumedSubscriptionId] of the tagging statement.
const tagged = (prisma: { $executeRaw: jest.Mock }) => {
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
    return prisma.$executeRaw.mock.calls[0][1].values
}

describe('selfCheckIn', () => {
    it('starts a first-visit abonement from the check-in', async () => {
        const prisma = makePrisma({
            subs: [
                sub('sub1', {
                    classesTotal: null,
                    classesRemaining: null,
                    endDate: null,
                    startsOnFirstVisit: true,
                }),
            ],
        })
        await run(prisma)
        expect(syncFirstVisitStartInTx).toHaveBeenCalledWith(prisma, {
            workspaceId: 'w1',
            userId: 'u1',
            now: expect.any(Date),
        })
    })

    it('leaves an ordinary abonement alone', async () => {
        await run(makePrisma())
        expect(syncFirstVisitStartInTx).not.toHaveBeenCalled()
    })

    it('checks a member in and deducts one class from their pack', async () => {
        const prisma = makePrisma()
        const res = await run(prisma)
        expect(prisma.attendanceRecord.createMany).toHaveBeenCalled()
        expect(prisma.subscription.updateManyAndReturn).toHaveBeenCalledWith({
            where: { id: { in: ['sub1'] }, classesRemaining: { gt: 0 } },
            data: { classesRemaining: { decrement: 1 } },
            select: { id: true, classesRemaining: true },
        })
        expect(tagged(prisma)).toEqual(['u1', 'sub1', 'sub1'])
        expect(res).toMatchObject({
            sessionId: 's1',
            checkedIn: true,
            classesRemaining: 2,
            abonement: {
                subscriptionId: 'sub1',
                planName: 'Plan sub1',
                classesTotal: 10,
                classesRemaining: 2,
                directions: [],
            },
        })
    })

    it('counts a visit on a time-based abonement without deducting', async () => {
        const prisma = makePrisma({
            subs: [sub('t1', { classesTotal: null, classesRemaining: null })],
        })
        const res = await run(prisma)
        expect(prisma.subscription.updateManyAndReturn).not.toHaveBeenCalled()
        expect(tagged(prisma)).toEqual(['u1', 't1', null])
        expect(res).toMatchObject({
            checkedIn: true,
            classesRemaining: null,
            abonement: { subscriptionId: 't1', classesRemaining: null },
        })
    })

    it.each([
        ['an expired pack', { endDate: new Date(Date.now() - 24 * 3600 * 1000) }],
        ['a cancelled pack', { status: 'CANCELLED' }],
    ])('does not deduct from %s, and still checks in', async (_name, over) => {
        const prisma = makePrisma({ subs: [sub('sub1', over)] })
        const res = await run(prisma)
        expect(prisma.attendanceRecord.createMany).toHaveBeenCalled()
        expect(prisma.subscription.updateManyAndReturn).not.toHaveBeenCalled()
        expect(res).toMatchObject({ checkedIn: true, classesRemaining: null, abonement: null })
    })

    describe('directions and several abonements', () => {
        it('draws the БЖЖ pack at a БЖЖ class', async () => {
            const prisma = makePrisma({
                subs: [sub('sub1', { directions: ['bjj'] })],
                direction: 'bjj',
            })
            const res = await run(prisma)
            expect(prisma.subscription.updateManyAndReturn).toHaveBeenCalledTimes(1)
            expect(res).toMatchObject({ checkedIn: true, classesRemaining: 2 })
        })

        it('checks in at an ММА class without touching or freeze-checking the БЖЖ pack', async () => {
            const prisma = makePrisma({
                subs: [sub('sub1', { directions: ['bjj'], frozen: true })],
                direction: 'mma',
                frozenUntil: new Date('2026-10-30T00:00:00Z'),
            })
            const res = await run(prisma)
            expect(prisma.attendanceRecord.createMany).toHaveBeenCalled()
            expect(prisma.subscription.updateManyAndReturn).not.toHaveBeenCalled()
            expect(prisma.subscriptionFreeze.findFirst).not.toHaveBeenCalled()
            expect(res).toMatchObject({ checkedIn: true, classesRemaining: null, abonement: null })
        })

        it('a frozen abonement does not block while another one covers the class', async () => {
            const prisma = makePrisma({
                subs: [
                    sub('bjj', { directions: ['bjj'], frozen: true }),
                    sub('club', { classesTotal: null, classesRemaining: null }),
                ],
                direction: 'bjj',
                frozenUntil: new Date('2026-10-30T00:00:00Z'),
            })
            const res = await run(prisma)
            expect(prisma.subscriptionFreeze.findFirst).not.toHaveBeenCalled()
            expect(tagged(prisma)).toEqual(['u1', 'club', null])
            expect(res.abonement?.subscriptionId).toBe('club')
        })

        it('spends the abonement the member picked', async () => {
            const prisma = makePrisma({
                subs: [
                    sub('bjj', { directions: ['bjj'] }),
                    sub('club', { classesTotal: null, classesRemaining: null }),
                ],
                direction: 'bjj',
            })
            await run(prisma, 'ABC234', 'club')
            expect(prisma.subscription.updateManyAndReturn).not.toHaveBeenCalled()
            expect(tagged(prisma)).toEqual(['u1', 'club', null])
        })

        it('refuses a picked abonement that cannot pay for this class, before writing', async () => {
            const prisma = makePrisma({
                subs: [sub('bjj', { directions: ['bjj'] }), sub('mma', { directions: ['mma'] })],
                direction: 'bjj',
            })
            await expect(run(prisma, 'ABC234', 'mma')).rejects.toThrow(
                'Этот абонемент нельзя списать на эту тренировку',
            )
            expect(prisma.$transaction).not.toHaveBeenCalled()
        })
    })

    it('refuses a frozen abonement before writing anything', async () => {
        const prisma = makePrisma({
            subs: [sub('sub1', { frozen: true })],
            frozenUntil: new Date('2026-10-30T00:00:00Z'),
        })
        await expect(run(prisma)).rejects.toThrow(
            /Абонемент заморожен по 30 октября\. Чтобы отметиться, попросите тренера или администратора клуба снять заморозку\./,
        )
        expect(prisma.$transaction).not.toHaveBeenCalled()
        expect(prisma.attendanceRecord.createMany).not.toHaveBeenCalled()
        // The session's day in the club timezone: 18:00Z is 21:00 Moscow, the 20th.
        expect(prisma.subscriptionFreeze.findFirst).toHaveBeenCalledWith({
            where: {
                subscriptionId: 'sub1',
                fromDate: { lte: new Date('2026-07-20T00:00:00Z') },
                untilDate: { gte: new Date('2026-07-20T00:00:00Z') },
            },
        })
    })

    it("judges freezes on the session's day in the club timezone, not today", async () => {
        const prisma = makePrisma()
        await run(prisma)
        expect(prisma.subscription.findMany.mock.calls[0][0].select.freezes.where).toEqual({
            fromDate: { lte: new Date('2026-07-20T00:00:00Z') },
            untilDate: { gte: new Date('2026-07-20T00:00:00Z') },
        })
    })

    it('does not look for a freeze when the member has no abonement', async () => {
        const prisma = makePrisma({ subs: [] })
        await run(prisma)
        expect(prisma.subscriptionFreeze.findFirst).not.toHaveBeenCalled()
    })

    it('uppercases the code before lookup', async () => {
        const prisma = makePrisma()
        await run(prisma, 'abc234')
        expect(
            prisma.attendanceSession.findFirst.mock.calls[0][0].where.checkInCode,
        ).toBe('ABC234')
    })

    it('never matches a personal session', async () => {
        const prisma = makePrisma()
        await run(prisma)
        expect(
            prisma.attendanceSession.findFirst.mock.calls[0][0].where.isPersonal,
        ).toBe(false)
    })

    it('rejects an unknown / expired code', async () => {
        const prisma = makePrisma({ session: null })
        await expect(run(prisma)).rejects.toBeInstanceOf(BadRequestError)
    })

    it.each([['SUSPENDED'], [null]])('forbids a member with status %s', async (status) => {
        const prisma = makePrisma({ status })
        await expect(run(prisma)).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.subscription.findMany).not.toHaveBeenCalled()
    })

    it('is a no-op deduction when already checked in, reporting what the visit was spent on', async () => {
        const prisma = makePrisma({
            alreadyPresent: true,
            usedRow: {
                id: 'sub1',
                classesTotal: 10,
                classesRemaining: 2,
                endDate: LIVE,
                plan: { name: 'Plan sub1' },
                directions: [],
            },
        })
        const res = await run(prisma)
        expect(res.checkedIn).toBe(false)
        expect(prisma.subscription.updateManyAndReturn).not.toHaveBeenCalled()
        expect(prisma.$executeRaw).not.toHaveBeenCalled()
        expect(res.abonement?.subscriptionId).toBe('sub1')
        expect(res.classesRemaining).toBe(2)
    })

    it('does not deduct when the member has no abonement', async () => {
        const prisma = makePrisma({ subs: [] })
        const res = await run(prisma)
        expect(res.checkedIn).toBe(true)
        expect(res.classesRemaining).toBeNull()
        expect(res.abonement).toBeNull()
        expect(prisma.subscription.updateManyAndReturn).not.toHaveBeenCalled()
        expect(prisma.$executeRaw).not.toHaveBeenCalled()
    })

    it('marks a non-group member as a guest', async () => {
        const prisma = makePrisma({ inGroup: false })
        await run(prisma)
        const rows = prisma.attendanceRecord.createMany.mock.calls[0][0].data
        expect(rows[0].isGuest).toBe(true)
    })

    it('hands the pack alert to the after-commit follow-up when a class was drawn', async () => {
        const prisma = makePrisma()
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
        expect(syncLastAttendedAt).toHaveBeenCalledWith(prisma, 'w1', ['u1'])
    })

    it('reports 0 left after the last class is used', async () => {
        const prisma = makePrisma({ subs: [sub('sub1', { classesRemaining: 1 })] })
        prisma.subscription.updateManyAndReturn.mockResolvedValue([
            { id: 'sub1', classesRemaining: 0 },
        ])
        const res = await run(prisma)
        expect(res.classesRemaining).toBe(0)
        expect(followUps.schedule).toHaveBeenCalledWith(
            expect.objectContaining({ subscriptionIds: ['sub1'] }),
        )
    })

    it('reports 0 left and schedules no pack alert when the only pack is used up', async () => {
        const prisma = makePrisma({ subs: [sub('sub1', { classesRemaining: 0 })] })
        const res = await run(prisma)
        expect(res).toMatchObject({ checkedIn: true, classesRemaining: 0, abonement: null })
        expect(followUps.schedule).toHaveBeenCalledWith(
            expect.objectContaining({ subscriptionIds: [] }),
        )
    })

    it('does nothing after the transaction when already checked in', async () => {
        await run(makePrisma({ alreadyPresent: true }))
        expect(followUps.schedule).not.toHaveBeenCalled()
        expect(leaderboard.invalidate).not.toHaveBeenCalled()
        expect(realtime.invalidateCoalesced).not.toHaveBeenCalled()
        expect(syncLastAttendedAt).not.toHaveBeenCalled()
    })

    it('does not tag the check-in when a concurrent one took the last class', async () => {
        const prisma = makePrisma({ subs: [sub('sub1', { classesRemaining: 1 })] })
        // The guarded decrement found the pack already at 0.
        prisma.subscription.updateManyAndReturn.mockResolvedValue([])
        const res = await run(prisma)
        expect(res.checkedIn).toBe(true)
        expect(res.classesRemaining).toBe(0)
        // No tag → an un-mark won't refund a class this check-in never drew.
        expect(prisma.$executeRaw).not.toHaveBeenCalled()
        expect(followUps.schedule).toHaveBeenCalledWith(
            expect.objectContaining({ subscriptionIds: [] }),
        )
    })
})
