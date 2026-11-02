jest.mock('../../infrastructure/prisma', () => ({ PrismaService: class {} }))

import { BadRequestError, ForbiddenError } from '../../shared/errors/shared.errors'
import { CreateWorkspaceEventFeature } from './create-workspace-event.feature'
import { CreateWorkspaceEventHandler } from './create-workspace-event.handler'
import { DeleteWorkspaceEventFeature } from './delete-workspace-event.feature'
import { DeleteWorkspaceEventHandler } from './delete-workspace-event.handler'
import { ListWorkspaceEventsFeature } from './list-workspace-events.feature'
import { ListWorkspaceEventsHandler } from './list-workspace-events.handler'
import { UpdateWorkspaceEventFeature } from './update-workspace-event.feature'
import { UpdateWorkspaceEventHandler } from './update-workspace-event.handler'

const BJJ = '11111111-1111-4111-8111-111111111111'
const MMA = '22222222-2222-4222-8222-222222222222'

// managed: null = admin, [] = plain coach, [..] = direction manager.
const rbac = (managed: string[] | null) => ({
    resolveCoachScope: jest.fn().mockResolvedValue({
        scope: managed === null ? 'admin' : 'coach_own_only',
    }),
    managedDirectionIds: jest.fn().mockResolvedValue(managed),
    assertCanManageDirection: jest.fn(
        async (_ctx: unknown, ...ids: Array<string | null | undefined>) => {
            if (managed === null) return
            const named = ids.filter((d) => d !== undefined)
            if (
                named.length === 0 ||
                named.some((d) => d === null || !managed.includes(d))
            ) {
                throw new ForbiddenError({
                    message: 'Нужны права администратора клуба',
                })
            }
        },
    ),
})

const eventRow = (directionId: string | null) => ({
    id: 'e1',
    workspaceId: 'w1',
    title: 'Семинар',
    description: null,
    link: null,
    startAt: new Date('2026-11-10T10:00:00Z'),
    endAt: new Date('2026-11-10T12:00:00Z'),
    timezone: 'Europe/Moscow',
    gymId: null,
    gym: null,
    directionId,
    direction: null,
    coachId: 'u1',
    coach: { id: 'u1', email: 'c@x', firstname: 'C', lastname: null },
    hostName: null as string | null,
    price: null as number | null,
    currency: 'RUB',
    capacity: null as number | null,
    createdById: 'u1',
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
})

const prismaFor = (current: string | null) => ({
    workspace: {
        findUnique: jest.fn().mockResolvedValue({ timezone: 'Europe/Moscow' }),
    },
    direction: { findFirst: jest.fn().mockResolvedValue({ id: 'x' }) },
    workspaceEvent: {
        create: jest.fn().mockResolvedValue(eventRow(current)),
        findFirst: jest.fn().mockResolvedValue(eventRow(current)),
        update: jest.fn().mockResolvedValue(eventRow(current)),
    },
})
const audit = () => ({ record: jest.fn().mockResolvedValue(undefined) })
const rt = () => ({ emitListDelta: jest.fn(), invalidate: jest.fn() })

const create = (
    prisma: unknown,
    r: unknown,
    directionId?: string,
    extra: Record<string, unknown> = {},
) =>
    new CreateWorkspaceEventHandler(
        prisma as never,
        audit() as never,
        rt() as never,
        r as never,
    ).execute(
        new CreateWorkspaceEventFeature(
            {
                title: 'Семинар',
                startAt: '2026-11-10T10:00',
                endAt: '2026-11-10T12:00',
                directionId,
                ...extra,
            } as never,
            'w1',
            'u1',
            'coach',
            false,
        ),
    )
const registrations = () => ({
    promote: jest.fn().mockResolvedValue(0),
    summaries: jest.fn().mockResolvedValue(new Map()),
    deleteEvent: jest.fn().mockResolvedValue(true),
})
const update = (
    prisma: unknown,
    r: unknown,
    payload: Record<string, unknown>,
    regs = registrations(),
) =>
    new UpdateWorkspaceEventHandler(
        prisma as never,
        audit() as never,
        rt() as never,
        r as never,
        regs as never,
    ).execute(
        new UpdateWorkspaceEventFeature(
            payload as never,
            'w1',
            'e1',
            'u1',
            'coach',
            false,
        ),
    )
const remove = (prisma: unknown, r: unknown, regs = registrations()) =>
    new DeleteWorkspaceEventHandler(
        prisma as never,
        audit() as never,
        rt() as never,
        r as never,
        regs as never,
    ).execute(new DeleteWorkspaceEventFeature('w1', 'e1', 'u1', 'coach', false))

describe('workspace events: plain coach (unchanged)', () => {
    it('creates, edits and deletes any event without a direction check', async () => {
        const prisma = prismaFor(MMA)
        const r = rbac([])
        const regs = registrations()
        await create(prisma, r)
        await update(prisma, r, { directionId: null })
        await remove(prisma, r, regs)
        expect(r.assertCanManageDirection).not.toHaveBeenCalled()
        expect(prisma.workspaceEvent.create).toHaveBeenCalled()
        expect(prisma.workspaceEvent.update).toHaveBeenCalled()
        // Through the guard that keeps paid tickets (deleteEvent).
        expect(regs.deleteEvent).toHaveBeenCalledWith('w1', 'e1')
    })

    it('admin is not checked either', async () => {
        const prisma = prismaFor(null)
        const r = rbac(null)
        await create(prisma, r)
        await remove(prisma, r)
        expect(r.assertCanManageDirection).not.toHaveBeenCalled()
    })
})

describe('workspace events: direction manager', () => {
    it('creates in a managed direction; refuses another or club-wide', async () => {
        const prisma = prismaFor(BJJ)
        const r = rbac([BJJ])
        await create(prisma, r, BJJ)
        await expect(create(prisma, r, MMA)).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        await expect(create(prisma, r)).rejects.toBeInstanceOf(ForbiddenError)
        expect(r.assertCanManageDirection).toHaveBeenLastCalledWith(
            expect.anything(),
            null,
        )
        expect(prisma.workspaceEvent.create).toHaveBeenCalledTimes(1)
    })

    it('edits own-direction events; refuses a move to another direction', async () => {
        const prisma = prismaFor(BJJ)
        const r = rbac([BJJ])
        await update(prisma, r, { title: 'Новый' })
        await expect(
            update(prisma, r, { directionId: MMA }),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(r.assertCanManageDirection).toHaveBeenLastCalledWith(
            expect.anything(),
            BJJ,
            MMA,
        )
        expect(prisma.workspaceEvent.update).toHaveBeenCalledTimes(1)
    })

    it('refuses editing a club-wide event', async () => {
        const prisma = prismaFor(null)
        await expect(
            update(prisma, rbac([BJJ]), { title: 'x' }),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.workspaceEvent.update).not.toHaveBeenCalled()
    })

    it('deletes own; refuses another direction event', async () => {
        const own = registrations()
        await remove(prismaFor(BJJ), rbac([BJJ]), own)
        expect(own.deleteEvent).toHaveBeenCalled()
        const other = registrations()
        await expect(
            remove(prismaFor(MMA), rbac([BJJ]), other),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(other.deleteEvent).not.toHaveBeenCalled()
    })

    it('an event with paid tickets is not deleted', async () => {
        const regs = registrations()
        regs.deleteEvent.mockRejectedValue(
            new BadRequestError({ message: 'Событие нельзя удалить' }),
        )
        const r = audit()
        await expect(
            new DeleteWorkspaceEventHandler(
                prismaFor(null) as never,
                r as never,
                rt() as never,
                rbac([]) as never,
                regs as never,
            ).execute(
                new DeleteWorkspaceEventFeature('w1', 'e1', 'u1', 'coach', false),
            ),
        ).rejects.toBeInstanceOf(BadRequestError)
        expect(r.record).not.toHaveBeenCalled()
    })
})

describe('workspace events: master class (price, places, guest host)', () => {
    it('creates a paid event with a limit; a guest host leaves the coach empty', async () => {
        const prisma = prismaFor(null)
        await create(prisma, rbac(null), undefined, {
            price: 1500,
            currency: 'rub',
            capacity: 3,
            hostName: 'Анна Петрова',
        })
        expect(prisma.workspaceEvent.create.mock.calls[0][0].data).toMatchObject({
            price: 1500,
            currency: 'RUB',
            capacity: 3,
            hostName: 'Анна Петрова',
            coachId: null,
        })
    })

    it('an event without them is created as before: free, no limit, the creator leads', async () => {
        const prisma = prismaFor(null)
        await create(prisma, rbac(null))
        const data = prisma.workspaceEvent.create.mock.calls[0][0].data
        expect(data).toMatchObject({ price: null, capacity: null, hostName: null, coachId: 'u1' })
        expect(data.currency).toBeUndefined()
    })

    it('a changed limit moves the waitlist up; other edits do not touch it', async () => {
        const prisma = prismaFor(null)
        const regs = registrations()
        await update(prisma, rbac(null), { title: 'Новый' }, regs)
        expect(regs.promote).not.toHaveBeenCalled()
        await update(prisma, rbac(null), { capacity: 5, price: null }, regs)
        expect(prisma.workspaceEvent.update.mock.calls[1][0].data).toMatchObject({
            capacity: 5,
            price: null,
        })
        expect(regs.promote).toHaveBeenCalledWith('w1', 'e1')
    })

    it('lists places for the viewer: a summary for registration events, null for open ones', async () => {
        const paid = { ...eventRow(null), id: 'e2', price: 1500, capacity: 3 }
        const prisma = {
            workspaceEvent: {
                findMany: jest.fn().mockResolvedValue([eventRow(null), paid]),
            },
            // A connected provider, the module on (no billing row: trial).
            workspace: {
                findUnique: jest
                    .fn()
                    .mockResolvedValue({ billing: null, moduleEntitlements: [] }),
            },
            workspacePaymentSettings: {
                findUnique: jest.fn().mockResolvedValue({ workspaceId: 'w1' }),
            },
        }
        const regs = registrations()
        const summary = { booked: 3, waitlist: 1, mine: null, onlinePayment: true }
        regs.summaries.mockResolvedValue(new Map([['e2', summary]]))
        const out = await new ListWorkspaceEventsHandler(
            prisma as never,
            regs as never,
        ).execute(new ListWorkspaceEventsFeature({}, 'w1', 'viewer'))
        expect(regs.summaries).toHaveBeenCalledWith(
            [eventRow(null), paid],
            'viewer',
            true,
        )
        expect(out.data.map((e) => [e.id, e.registration, e.price])).toEqual([
            ['e1', null, null],
            ['e2', summary, 1500],
        ])
    })
})
