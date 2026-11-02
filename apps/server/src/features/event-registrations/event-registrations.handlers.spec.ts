jest.mock('../../infrastructure/prisma', () => ({ PrismaService: class {} }))

import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { CancelEventRegistrationFeature } from './cancel-event-registration.feature'
import { CancelEventRegistrationHandler } from './cancel-event-registration.handler'
import { ListEventRegistrationsFeature } from './list-event-registrations.feature'
import { ListEventRegistrationsHandler } from './list-event-registrations.handler'
import { MarkEventRegistrationPaidFeature } from './mark-event-registration-paid.feature'
import { MarkEventRegistrationPaidHandler } from './mark-event-registration-paid.handler'
import { RegisterForEventFeature } from './register-for-event.feature'
import { RegisterForEventHandler } from './register-for-event.handler'
import { UnmarkEventRegistrationPaidFeature } from './unmark-event-registration-paid.feature'
import { UnmarkEventRegistrationPaidHandler } from './unmark-event-registration-paid.handler'

const BJJ = '11111111-1111-4111-8111-111111111111'
const MMA = '22222222-2222-4222-8222-222222222222'

// scope: 'admin' | 'coach' | 'member' (a member is refused by the scope
// resolver, as RbacService does); managed: directions a coach runs.
const rbac = (scope: 'admin' | 'coach' | 'member', managed: string[] = []) => ({
    resolveCoachScope: jest.fn(async () => {
        if (scope === 'member') {
            throw new ForbiddenError({ message: 'Нужны права администратора клуба' })
        }
        return { scope: scope === 'admin' ? 'admin' : 'coach_own_only', userId: 'staff' }
    }),
    canWriteAllGroups: jest.fn(() => scope === 'admin'),
    managedDirectionIds: jest.fn(async () => (scope === 'admin' ? null : managed)),
    assertCanManageDirection: jest.fn(async (_ctx: unknown, id: string | null) => {
        if (scope === 'admin') return
        if (id === null || !managed.includes(id)) {
            throw new ForbiddenError({ message: 'Нужны права администратора клуба' })
        }
    }),
})

const user = { firstname: 'Аня', lastname: 'Иванова', email: 'a@x' }
const reg = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    workspaceId: 'w1',
    eventId: 'e1',
    userId: 'm1',
    status: 'BOOKED',
    bookedById: 'm1',
    promotedAt: null,
    cancelledAt: null,
    isPaid: false,
    paidAt: null,
    amountPaid: null,
    currency: null,
    paymentMethod: null,
    markedPaidById: null,
    createdAt: new Date('2026-11-01T10:00:00Z'),
    user,
    ...over,
})

const services = () => ({
    audit: { record: jest.fn().mockResolvedValue(undefined) },
    registrations: {
        invalidate: jest.fn(),
        register: jest.fn().mockResolvedValue({ id: 'r1' }),
        cancelOwn: jest.fn().mockResolvedValue({ id: 'r1' }),
    },
})

describe('member actions go to the service as the acting member', () => {
    it('a guardian registers their child: the place is the child’s, the guardian pressed it', async () => {
        const { registrations } = services()
        await new RegisterForEventHandler(registrations as never).execute(
            new RegisterForEventFeature('w1', 'e1', 'child', 'parent'),
        )
        expect(registrations.register).toHaveBeenCalledWith({
            workspaceId: 'w1',
            eventId: 'e1',
            userId: 'child',
            actorId: 'parent',
        })
        await new CancelEventRegistrationHandler(registrations as never).execute(
            new CancelEventRegistrationFeature('w1', 'r1', 'child'),
        )
        expect(registrations.cancelOwn).toHaveBeenCalledWith({
            workspaceId: 'w1',
            userId: 'child',
            registrationId: 'r1',
        })
    })
})

describe('ListEventRegistrationsHandler', () => {
    const prisma = (rows: unknown[] = [], event: unknown = { id: 'e1', capacity: 2, price: 1500, currency: 'RUB' }) => ({
        workspaceEvent: { findFirst: jest.fn().mockResolvedValue(event) },
        eventRegistration: { findMany: jest.fn().mockResolvedValue(rows) },
    })
    const run = (p: unknown, r: unknown) =>
        new ListEventRegistrationsHandler(p as never, r as never).execute(
            new ListEventRegistrationsFeature('w1', 'e1', 'staff', 'coach', false),
        )

    it('refuses a member', async () => {
        const p = prisma()
        await expect(run(p, rbac('member'))).rejects.toBeInstanceOf(ForbiddenError)
        expect(p.eventRegistration.findMany).not.toHaveBeenCalled()
    })

    it('404s on an event of another club', async () => {
        await expect(run(prisma([], null), rbac('coach'))).rejects.toBeInstanceOf(NotFoundError)
    })

    it('a coach sees places, then the waitlist in order, then cancelled — and what was paid', async () => {
        const rows = [
            reg({ id: 'r4', userId: 'm4', status: 'CANCELLED', isPaid: true, amountPaid: 1500, currency: 'RUB', createdAt: new Date('2026-11-01T09:00:00Z') }),
            reg({ id: 'r3', userId: 'm3', status: 'WAITLISTED', createdAt: new Date('2026-11-01T12:00:00Z') }),
            reg({ id: 'r2', userId: 'm2', status: 'WAITLISTED', bookedById: 'parent', createdAt: new Date('2026-11-01T11:00:00Z') }),
            reg({ id: 'r1', isPaid: true, amountPaid: 1500, currency: 'RUB', paymentMethod: 'CASH' }),
        ]
        const out = await run(prisma(rows), rbac('coach'))
        expect(out.data.map((r) => [r.id, r.status, r.waitlistPosition])).toEqual([
            ['r1', 'BOOKED', null],
            ['r2', 'WAITLISTED', 1],
            ['r3', 'WAITLISTED', 2],
            ['r4', 'CANCELLED', null],
        ])
        expect(out).toMatchObject({ booked: 1, waitlist: 2, capacity: 2, price: 1500 })
        expect(out.paid).toEqual({ count: 2, amount: 3000 })
        expect(out.data[1].bookedByOther).toBe(true)
        expect(out.data[0]).toMatchObject({ name: 'Аня Иванова', paymentMethod: 'CASH' })
    })
})

describe('MarkEventRegistrationPaidHandler', () => {
    const event = (over: Record<string, unknown> = {}) => ({
        id: 'e1',
        title: 'Мастер-класс',
        price: 1500,
        currency: 'RUB',
        directionId: BJJ,
        ...over,
    })
    const prisma = (row: unknown) => {
        const after = row ? { ...(row as object), isPaid: true, amountPaid: 1500, currency: 'RUB', paymentMethod: 'TRANSFER' } : null
        return {
            eventRegistration: {
                findFirst: jest.fn().mockResolvedValue(row),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                findUniqueOrThrow: jest.fn().mockResolvedValue(after),
            },
        }
    }
    const run = (p: unknown, r: unknown, invoker = 'staff') => {
        const s = services()
        const out = new MarkEventRegistrationPaidHandler(
            p as never,
            r as never,
            s.audit as never,
            s.registrations as never,
        ).execute(
            new MarkEventRegistrationPaidFeature(
                { method: 'TRANSFER' },
                'w1',
                'r1',
                invoker,
                'coach',
                false,
            ),
        )
        return { out, ...s }
    }

    it('marks the ticket paid at the event’s price and records it', async () => {
        const p = prisma(reg({ event: event() }))
        const { out, audit, registrations } = run(p, rbac('coach'))
        expect(await out).toMatchObject({ isPaid: true, amountPaid: 1500, paymentMethod: 'TRANSFER' })
        const call = p.eventRegistration.updateMany.mock.calls[0][0]
        expect(call.where).toEqual({ id: 'r1', isPaid: false, status: 'BOOKED' })
        expect(call.data).toMatchObject({
            isPaid: true,
            amountPaid: 1500,
            currency: 'RUB',
            paymentMethod: 'TRANSFER',
            markedPaidById: 'staff',
        })
        expect(call.data.paidAt).toBeInstanceOf(Date)
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'event.markRegistrationPaid', targetId: 'e1' }),
        )
        expect(registrations.invalidate).toHaveBeenCalledWith('w1')
    })

    it('a second mark changes nothing and records nothing', async () => {
        const p = prisma(reg({ event: event() }))
        p.eventRegistration.updateMany.mockResolvedValue({ count: 0 })
        const { out, audit } = run(p, rbac('admin'))
        await out
        expect(audit.record).not.toHaveBeenCalled()
    })

    it('refuses a member, a coach’s own ticket and a direction manager of another direction', async () => {
        const p = prisma(reg({ event: event() }))
        await expect(run(p, rbac('member')).out).rejects.toBeInstanceOf(ForbiddenError)
        const own = prisma(reg({ userId: 'staff', event: event() }))
        await expect(run(own, rbac('coach'), 'staff').out).rejects.toThrow(/собственной/)
        await expect(run(p, rbac('coach', [MMA])).out).rejects.toBeInstanceOf(ForbiddenError)
        expect(p.eventRegistration.updateMany).not.toHaveBeenCalled()
        // The manager of the event's direction may.
        await run(p, rbac('coach', [BJJ])).out
        expect(p.eventRegistration.updateMany).toHaveBeenCalledTimes(1)
    })

    it('a free event has nothing to pay; an unknown registration is not found', async () => {
        await expect(
            run(prisma(reg({ event: event({ price: null }) })), rbac('admin')).out,
        ).rejects.toBeInstanceOf(BadRequestError)
        await expect(run(prisma(null), rbac('admin')).out).rejects.toBeInstanceOf(NotFoundError)
    })

    it('no payment without a place: the waitlist and a cancelled registration are refused', async () => {
        for (const status of ['WAITLISTED', 'CANCELLED']) {
            const p = prisma(reg({ status, event: event() }))
            await expect(run(p, rbac('admin')).out).rejects.toThrow(/есть место/)
            expect(p.eventRegistration.updateMany).not.toHaveBeenCalled()
        }
    })
})

describe('UnmarkEventRegistrationPaidHandler', () => {
    const prisma = () => ({
        eventRegistration: {
            findFirst: jest.fn().mockResolvedValue(
                reg({ isPaid: true, amountPaid: 1500, currency: 'RUB', event: { id: 'e1', title: 'МК' } }),
            ),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findUniqueOrThrow: jest.fn().mockResolvedValue(reg()),
        },
    })
    const run = (p: unknown, r: unknown) => {
        const s = services()
        const out = new UnmarkEventRegistrationPaidHandler(
            p as never,
            r as never,
            s.audit as never,
            s.registrations as never,
        ).execute(new UnmarkEventRegistrationPaidFeature('w1', 'r1', 'staff', 'coach', false))
        return { out, ...s }
    }

    it('only an admin takes a payment back', async () => {
        const p = prisma()
        await expect(run(p, rbac('coach')).out).rejects.toThrow(/администратора/)
        expect(p.eventRegistration.updateMany).not.toHaveBeenCalled()
        const { out, audit } = run(p, rbac('admin'))
        expect(await out).toMatchObject({ isPaid: false, amountPaid: null })
        expect(p.eventRegistration.updateMany.mock.calls[0][0]).toEqual({
            where: { id: 'r1', isPaid: true, paymentMethod: { not: 'ONLINE' } },
            data: {
                isPaid: false,
                paidAt: null,
                amountPaid: null,
                currency: null,
                paymentMethod: null,
                markedPaidById: null,
            },
        })
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'event.unmarkRegistrationPaid' }),
        )
    })

    it('a ticket paid online is taken back only by refunding its payment', async () => {
        const p = prisma()
        p.eventRegistration.findFirst.mockResolvedValue(
            reg({ isPaid: true, amountPaid: 1500, currency: 'RUB', paymentMethod: 'ONLINE', event: { id: 'e1', title: 'МК' } }),
        )
        await expect(run(p, rbac('admin')).out).rejects.toThrow(/Платежи/)
        expect(p.eventRegistration.updateMany).not.toHaveBeenCalled()
    })
})
