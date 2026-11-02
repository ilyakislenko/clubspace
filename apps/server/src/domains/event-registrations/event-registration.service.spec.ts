import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { EventRegistrationService, registrationOpen } from './event-registration.service'

const START = new Date('2026-11-14T12:00:00Z')
const BEFORE = new Date('2026-11-10T10:00:00Z')
const AFTER = new Date('2026-11-14T12:30:00Z')

type Row = {
    id: string
    workspaceId: string
    eventId: string
    userId: string
    status: string
    bookedById: string | null
    promotedAt: Date | null
    cancelledAt: Date | null
    isPaid: boolean
    createdAt: Date
}

type Where = {
    id?: string
    workspaceId?: string
    userId?: string
    eventId?: string | { in: string[] }
    status?: string | { in: string[] }
}

const matches = (r: Row, w: Where): boolean =>
    (w.id === undefined || r.id === w.id) &&
    (w.workspaceId === undefined || r.workspaceId === w.workspaceId) &&
    (w.userId === undefined || r.userId === w.userId) &&
    (w.eventId === undefined ||
        (typeof w.eventId === 'string'
            ? r.eventId === w.eventId
            : w.eventId.in.includes(r.eventId))) &&
    (w.status === undefined ||
        (typeof w.status === 'string'
            ? r.status === w.status
            : w.status.in.includes(r.status)))

// An in-memory registration table: the rules are asserted on what the service
// wrote, not on canned rows.
const makeWorld = (
    event: { price: number | null; capacity: number | null },
    seed: Array<Partial<Row> & { userId: string; status: string }> = [],
) => {
    let seq = 0
    const rows: Row[] = seed.map((s) => ({
        id: `r${++seq}`,
        workspaceId: 'ws-1',
        eventId: 'ev-1',
        bookedById: s.userId,
        promotedAt: null,
        cancelledAt: null,
        isPaid: false,
        createdAt: new Date(Date.UTC(2026, 10, 1, 0, seq)),
        ...s,
    }))
    const eventRow = {
        id: 'ev-1',
        workspaceId: 'ws-1',
        title: 'Мастер-класс: dancehall',
        startAt: START,
        timezone: 'Europe/Moscow',
        ...event,
    }
    const prisma = {
        workspaceEvent: {
            findFirst: jest.fn(async ({ where }: { where: { id: string; workspaceId: string } }) =>
                where.id === eventRow.id && where.workspaceId === eventRow.workspaceId
                    ? eventRow
                    : null,
            ),
        },
        workspaceMember: {
            findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
        },
        workspace: { findUnique: jest.fn().mockResolvedValue({ type: 'DANCE' }) },
        eventRegistration: {
            findMany: jest.fn(async ({ where }: { where: Where }) =>
                rows.filter((r) => matches(r, where)).map((r) => ({ ...r })),
            ),
            findFirst: jest.fn(
                async ({ where }: { where: Where }) =>
                    rows.find((r) => matches(r, where)) ?? null,
            ),
            findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
                const row = rows.find((r) => r.id === where.id)
                if (!row) throw new Error('missing')
                return { ...row }
            }),
            create: jest.fn(async ({ data }: { data: Partial<Row> }) => {
                const row = {
                    id: `r${++seq}`,
                    promotedAt: null,
                    cancelledAt: null,
                    isPaid: false,
                    createdAt: new Date(Date.UTC(2026, 10, 2, 0, seq)),
                    bookedById: null,
                    ...data,
                } as Row
                rows.push(row)
                return { ...row }
            }),
            update: jest.fn(
                async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
                    const row = rows.find((r) => r.id === where.id)!
                    Object.assign(row, data)
                    return { ...row }
                },
            ),
            updateMany: jest.fn(
                async ({ where, data }: { where: Where; data: Partial<Row> }) => {
                    const hit = rows.filter((r) => matches(r, where))
                    for (const r of hit) Object.assign(r, data)
                    return { count: hit.length }
                },
            ),
        },
        // The event row lock: the capacity as it is now.
        $queryRaw: jest.fn(async () => [
            { capacity: eventRow.capacity, startAt: eventRow.startAt },
        ]),
        $transaction: jest.fn(),
    }
    prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
        fn(prisma),
    )
    const notifications = { notifyUser: jest.fn().mockResolvedValue(true) }
    const realtime = { invalidate: jest.fn() }
    const service = new EventRegistrationService(
        prisma as never,
        notifications as never,
        realtime as never,
    )
    const statusOf = (userId: string) =>
        rows.filter((r) => r.userId === userId).map((r) => r.status)
    return { service, prisma, rows, eventRow, notifications, realtime, statusOf }
}

const register = (w: ReturnType<typeof makeWorld>, userId: string, now = BEFORE) =>
    w.service.register({
        workspaceId: 'ws-1',
        eventId: 'ev-1',
        userId,
        actorId: userId,
        now,
    })

describe('registrationOpen', () => {
    it('a price or a limit opens registration; neither keeps the event open as before', () => {
        expect(registrationOpen({ price: null, capacity: null })).toBe(false)
        expect(registrationOpen({ price: 1500, capacity: null })).toBe(true)
        expect(registrationOpen({ price: null, capacity: 10 })).toBe(true)
    })
})

describe('EventRegistrationService.register', () => {
    it('places members up to the limit, then the waitlist in order; a re-send returns the same', async () => {
        const w = makeWorld({ price: 1500, capacity: 2 })
        const a = await register(w, 'a')
        const b = await register(w, 'b')
        const c = await register(w, 'c')
        const d = await register(w, 'd')
        expect([a.status, b.status, c.status, d.status]).toEqual([
            'BOOKED',
            'BOOKED',
            'WAITLISTED',
            'WAITLISTED',
        ])
        expect(c.waitlistPosition).toBe(1)
        expect(d.waitlistPosition).toBe(2)
        expect(a.waitlistPosition).toBeNull()
        const again = await register(w, 'a')
        expect(again.id).toBe(a.id)
        expect(w.rows).toHaveLength(4)
        expect(w.realtime.invalidate).toHaveBeenCalledWith('ws-1', [
            'events',
            'eventregistrations',
        ])
    })

    it('takes the event row lock inside the transaction', async () => {
        const w = makeWorld({ price: 1500, capacity: 2 })
        await register(w, 'a')
        expect(w.prisma.$transaction).toHaveBeenCalledTimes(1)
        const sql = (w.prisma.$queryRaw.mock.calls[0] as unknown as [string[]])[0].join('?')
        expect(sql).toContain('FOR UPDATE')
        expect(sql).toContain('"WorkspaceEvent"')
    })

    it('no limit: everyone gets a place', async () => {
        const w = makeWorld({ price: 1500, capacity: null })
        for (const u of ['a', 'b', 'c']) await register(w, u)
        expect(w.rows.map((r) => r.status)).toEqual(['BOOKED', 'BOOKED', 'BOOKED'])
    })

    it('a free event without a limit needs no registration (as before)', async () => {
        const w = makeWorld({ price: null, capacity: null })
        await expect(register(w, 'a')).rejects.toBeInstanceOf(BadRequestError)
        expect(w.rows).toHaveLength(0)
    })

    it('closes when the event has started', async () => {
        const w = makeWorld({ price: 1500, capacity: 3 })
        await expect(register(w, 'a', AFTER)).rejects.toThrow(/уже началось/)
    })

    it('refuses a non-member (the owner has no member row) and a suspended member', async () => {
        const w = makeWorld({ price: 1500, capacity: 3 })
        w.prisma.workspaceMember.findUnique.mockResolvedValueOnce(null)
        await expect(register(w, 'owner')).rejects.toBeInstanceOf(ForbiddenError)
        w.prisma.workspaceMember.findUnique.mockResolvedValueOnce({ status: 'SUSPENDED' })
        await expect(register(w, 'a')).rejects.toThrow(/приостановлено/)
        expect(w.rows).toHaveLength(0)
    })

    it('an event of another club is not found', async () => {
        const w = makeWorld({ price: 1500, capacity: 3 })
        await expect(
            w.service.register({ workspaceId: 'ws-2', eventId: 'ev-1', userId: 'a', actorId: 'a', now: BEFORE }),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('a place freed outside a registration (a member left) goes to the waitlist before a newcomer', async () => {
        const w = makeWorld({ price: 1500, capacity: 1 }, [
            { userId: 'left', status: 'CANCELLED' },
            { userId: 'waiting', status: 'WAITLISTED' },
        ])
        const mine = await register(w, 'new')
        expect(w.statusOf('waiting')).toEqual(['BOOKED'])
        expect(mine.status).toBe('WAITLISTED')
        expect(w.notifications.notifyUser).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'waiting', kind: 'eventregistration.promoted' }),
        )
    })
})

describe('EventRegistrationService.cancelOwn', () => {
    const full = () =>
        makeWorld({ price: 1500, capacity: 1 }, [
            { userId: 'a', status: 'BOOKED' },
            { userId: 'b', status: 'WAITLISTED' },
            { userId: 'c', status: 'WAITLISTED' },
        ])
    const cancel = (w: ReturnType<typeof makeWorld>, userId: string, id: string, now = BEFORE) =>
        w.service.cancelOwn({ workspaceId: 'ws-1', userId, registrationId: id, now })

    it('a freed place goes to the first in the waitlist, who gets «Освободилось место»', async () => {
        const w = full()
        const out = await cancel(w, 'a', 'r1')
        expect(out.status).toBe('CANCELLED')
        expect(out.cancelledAt).toBe(BEFORE.toISOString())
        expect(w.statusOf('b')).toEqual(['BOOKED'])
        expect(w.rows.find((r) => r.userId === 'b')?.promotedAt).toEqual(BEFORE)
        expect(w.statusOf('c')).toEqual(['WAITLISTED'])
        expect(w.notifications.notifyUser).toHaveBeenCalledTimes(1)
        expect(w.notifications.notifyUser).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'b',
                kind: 'eventregistration.promoted',
                refId: 'r2',
                topic: 'Освободилось место',
                workspaceId: 'ws-1',
            }),
        )
        // A second cancel is a no-op: nobody else moves up.
        await cancel(w, 'a', 'r1')
        expect(w.statusOf('c')).toEqual(['WAITLISTED'])
    })

    it('leaving the waitlist frees no place', async () => {
        const w = full()
        await cancel(w, 'b', 'r2')
        expect(w.statusOf('c')).toEqual(['WAITLISTED'])
        expect(w.notifications.notifyUser).not.toHaveBeenCalled()
    })

    it('only their own registration; not after the start', async () => {
        const w = full()
        await expect(cancel(w, 'b', 'r1')).rejects.toBeInstanceOf(NotFoundError)
        await expect(cancel(w, 'a', 'r1', AFTER)).rejects.toThrow(/уже началось/)
        expect(w.statusOf('a')).toEqual(['BOOKED'])
    })

    it('a failed push never undoes the promotion', async () => {
        const w = full()
        w.notifications.notifyUser.mockRejectedValueOnce(new Error('fcm down'))
        await cancel(w, 'a', 'r1')
        expect(w.statusOf('b')).toEqual(['BOOKED'])
    })
})

describe('EventRegistrationService.promote', () => {
    it('a raised limit moves as many as fit', async () => {
        const w = makeWorld({ price: null, capacity: 3 }, [
            { userId: 'a', status: 'BOOKED' },
            { userId: 'b', status: 'WAITLISTED' },
            { userId: 'c', status: 'WAITLISTED' },
            { userId: 'd', status: 'WAITLISTED' },
        ])
        expect(await w.service.promote('ws-1', 'ev-1', BEFORE)).toBe(2)
        expect(w.rows.map((r) => r.status)).toEqual(['BOOKED', 'BOOKED', 'BOOKED', 'WAITLISTED'])
    })

    it('no promotion once the event has started', async () => {
        const w = makeWorld({ price: null, capacity: 5 }, [
            { userId: 'b', status: 'WAITLISTED' },
        ])
        expect(await w.service.promote('ws-1', 'ev-1', AFTER)).toBe(0)
        expect(w.notifications.notifyUser).not.toHaveBeenCalled()
    })
})

describe('EventRegistrationService.summaries', () => {
    it('counts places and the queue for registration events only, with the viewer’s own', async () => {
        const w = makeWorld({ price: 1500, capacity: 1 }, [
            { userId: 'a', status: 'BOOKED' },
            { userId: 'b', status: 'WAITLISTED' },
            { userId: 'me', status: 'WAITLISTED' },
            { userId: 'gone', status: 'CANCELLED' },
        ])
        const out = await w.service.summaries(
            [
                { id: 'ev-1', price: 1500, capacity: 1 },
                { id: 'open', price: null, capacity: null },
            ],
            'me',
            true,
        )
        expect(out.get('open')).toBeUndefined()
        expect(out.get('ev-1')).toMatchObject({
            booked: 1,
            waitlist: 2,
            mine: { id: 'r3', status: 'WAITLISTED', waitlistPosition: 2, isPaid: false },
            // The club takes payments online and the event is paid.
            onlinePayment: true,
        })
        const query = w.prisma.eventRegistration.findMany.mock.calls[0][0].where
        expect(query.eventId).toEqual({ in: ['ev-1'] })
    })

    it('no registration events: no query', async () => {
        const w = makeWorld({ price: null, capacity: null })
        const out = await w.service.summaries(
            [{ id: 'ev-1', price: null, capacity: null }],
            'me',
            false,
        )
        expect(out.size).toBe(0)
        expect(w.prisma.eventRegistration.findMany).not.toHaveBeenCalled()
    })
})
