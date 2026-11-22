import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { ownGroupsWhere, RbacService } from '../../shared/services/rbac.service'
import { GetGroupFeature } from './get-group.feature'
import { GetGroupHandler } from './get-group.handler'

const GROUP = '22222222-2222-4222-8222-222222222222'
const coachUser = { id: 'c1', email: 'c@x', firstname: 'Роман', lastname: 'С' }

const slot = (over: object) => ({
    id: 's1',
    dayOfWeek: 2,
    startTime: '19:00',
    durationMin: 90,
    effectiveFrom: null,
    effectiveUntil: null,
    capacity: null,
    ...over,
})

const groupRow = {
    id: GROUP,
    name: 'БЖЖ взрослые',
    gym: { id: 'g1', name: 'Зал 1', address: 'ул. 1' },
    direction: null,
    coach: coachUser,
    bookingMode: 'FIXED',
    capacity: null,
    bookingWindowDays: null,
    bookingCancelHours: null,
    coaches: [{ role: 'primary', user: coachUser }],
    slots: [
        slot({}),
        // A class moved to Friday once: shown in slots, not in the week.
        slot({
            id: 's2',
            dayOfWeek: 5,
            effectiveFrom: new Date('2026-11-20T00:00:00Z'),
            effectiveUntil: new Date('2026-11-20T00:00:00Z'),
        }),
    ],
    exceptions: [
        {
            id: 'e1',
            slotId: null,
            fromDate: new Date('2026-12-30T00:00:00Z'),
            untilDate: new Date('2027-01-08T00:00:00Z'),
            reason: 'Каникулы',
        },
    ],
    _count: { members: 2 },
    updatedAt: new Date('2026-11-14T10:00:00.000Z'),
}

const make = (opts: {
    scope: 'admin' | 'coach_read_all' | 'coach_own_only'
    own?: boolean
    group?: object | null
}) => {
    const prisma = {
        workspace: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Europe/Moscow' }) },
        group: {
            findFirst: jest
                .fn()
                .mockResolvedValue(opts.group === undefined ? groupRow : opts.group),
            count: jest.fn().mockResolvedValue(opts.own ? 1 : 0),
        },
    }
    const rbac = new RbacService(prisma as never)
    jest.spyOn(rbac, 'resolveCoachScope').mockImplementation(async (p) => ({
        scope: opts.scope,
        userId: p.userId,
        workspaceId: p.workspaceId,
        workspaceOwnerId: 'owner',
    }))
    const run = (groupId = GROUP) =>
        new GetGroupHandler(prisma as never, rbac).execute(
            new GetGroupFeature(groupId, 'w1', 'me', 'coach', false),
        )
    return { prisma, run }
}

describe('GetGroupHandler', () => {
    it('gives the card without a roster: size, week, running slots and upcoming exceptions', async () => {
        const { prisma, run } = make({ scope: 'admin' })
        const out = await run()
        expect(out).toMatchObject({
            id: GROUP,
            canEdit: true,
            memberCount: 2,
            gym: { id: 'g1', name: 'Зал 1', address: 'ул. 1' },
            week: [{ dayOfWeek: 2, startTime: '19:00' }],
            exceptions: [
                { id: 'e1', slotId: null, fromDate: '2026-12-30', untilDate: '2027-01-08' },
            ],
        })
        expect(out.slots.map((s) => s.id)).toEqual(['s1', 's2'])
        expect(out).not.toHaveProperty('members')
        // Ended slots and past exceptions are not read.
        const include = prisma.group.findFirst.mock.calls[0][0].include
        expect(include.slots.where).toEqual({
            OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: expect.any(Date) } }],
        })
        expect(include.exceptions.where).toEqual({ untilDate: { gte: expect.any(Date) } })
        expect(include).not.toHaveProperty('members')
        // No own-group probe for admin scope.
        expect(prisma.group.count).not.toHaveBeenCalled()
    })

    it('lets a coach (or direction manager) open their own group, editable', async () => {
        const { prisma, run } = make({ scope: 'coach_own_only', own: true })
        await expect(run()).resolves.toMatchObject({ canEdit: true })
        expect(prisma.group.count.mock.calls[0][0].where).toEqual({
            id: GROUP,
            workspaceId: 'w1',
            ...ownGroupsWhere('me'),
        })
    })

    it('refuses coach_own_only a group they do not run', async () => {
        const { run } = make({ scope: 'coach_own_only', own: false })
        await expect(run()).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('shows coach_read_all another group read-only', async () => {
        const { run } = make({ scope: 'coach_read_all', own: false })
        await expect(run()).resolves.toMatchObject({ canEdit: false })
    })

    it('is a 404 for a group of another club or a malformed id', async () => {
        const { prisma, run } = make({ scope: 'admin', group: null })
        await expect(run()).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.group.findFirst.mock.calls[0][0].where).toEqual({
            id: GROUP,
            workspaceId: 'w1',
        })
        await expect(run('nope')).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.group.findFirst).toHaveBeenCalledTimes(1)
    })

    it('propagates a refusal from resolveCoachScope', async () => {
        const { prisma } = make({ scope: 'admin' })
        const rbacError = new ForbiddenError({ message: 'no' })
        jest.spyOn(RbacService.prototype, 'resolveCoachScope').mockRejectedValueOnce(rbacError)
        const handler = new GetGroupHandler(prisma as never, new RbacService(prisma as never))
        await expect(
            handler.execute(new GetGroupFeature(GROUP, 'w1', 'me', 'user', false)),
        ).rejects.toBe(rbacError)
        expect(prisma.group.findFirst).not.toHaveBeenCalled()
    })
})
