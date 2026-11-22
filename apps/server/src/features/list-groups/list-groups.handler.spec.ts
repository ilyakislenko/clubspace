import { ForbiddenError } from '../../shared/errors/shared.errors'
import { ownGroupsWhere, RbacService } from '../../shared/services/rbac.service'
import { ListGroupsFeature } from './list-groups.feature'
import { ListGroupsHandler } from './list-groups.handler'

type Scope = 'admin' | 'coach_read_all' | 'coach_own_only'

const make = (scope: Scope) => {
    const prisma = {
        group: { findMany: jest.fn().mockResolvedValue([]) },
        workspace: {
            findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Tomsk' }),
        },
    }
    // The real scope rules; only the role lookup is stubbed.
    const rbac = new RbacService(prisma as never)
    const resolveCoachScope = jest
        .spyOn(rbac, 'resolveCoachScope')
        .mockImplementation(async (p) => ({
            scope,
            userId: p.userId,
            workspaceId: p.workspaceId,
            workspaceOwnerId: 'owner',
        }))
    const handler = new ListGroupsHandler(prisma as never, rbac)
    const run = (filters: { coachId?: string; directionId?: string } = {}) =>
        handler.execute(new ListGroupsFeature('w1', 'me', 'coach', false, filters))
    const where = () => prisma.group.findMany.mock.calls[0][0].where
    return { prisma, resolveCoachScope, run, where }
}

describe('ListGroupsHandler', () => {
    it('propagates a refusal from resolveCoachScope', async () => {
        const { prisma, resolveCoachScope, run } = make('admin')
        resolveCoachScope.mockRejectedValueOnce(new ForbiddenError({ message: 'no' }))
        await expect(run()).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.group.findMany).not.toHaveBeenCalled()
    })

    it('limits coach_own_only to own groups: coached (assistants too) or of a managed direction', async () => {
        const { run, where } = make('coach_own_only')
        // A prying ?coachId= is ignored.
        await expect(run({ coachId: 'other', directionId: 'd1' })).resolves.toEqual({
            data: [],
            total: 0,
        })
        expect(where()).toEqual({
            workspaceId: 'w1',
            ...ownGroupsWhere('me'),
            directionId: 'd1',
        })
    })

    it('lets coach_read_all list every group but not filter by another coach', async () => {
        const { run, where } = make('coach_read_all')
        await run({ coachId: 'other' })
        expect(where()).toEqual({ workspaceId: 'w1' })
    })

    it('lets admin scope filter by coach', async () => {
        const { run, where } = make('admin')
        await run({ coachId: 'other' })
        expect(where()).toEqual({ workspaceId: 'w1', coachId: 'other' })
    })

    it('lists slim rows: size and the week, no roster, no ended slots', async () => {
        const { prisma, run } = make('admin')
        const coach = { id: 'c1', email: null, firstname: 'Роман', lastname: 'С' }
        const slot = (dayOfWeek: number, startTime: string, from?: string, until?: string) => ({
            dayOfWeek,
            startTime,
            effectiveFrom: from ? new Date(from) : null,
            effectiveUntil: until ? new Date(until) : null,
        })
        prisma.group.findMany.mockResolvedValueOnce([
            {
                id: 'g1',
                name: 'БЖЖ взрослые',
                gym: { id: 'h1', name: 'Зал 1' },
                direction: null,
                coach,
                bookingMode: 'FIXED',
                capacity: null,
                bookingWindowDays: null,
                bookingCancelHours: null,
                coaches: [{ role: 'primary', user: coach }],
                slots: [
                    slot(1, '19:00'),
                    // The same weekly class split by a «from this date» change.
                    slot(1, '19:00', '2026-12-01'),
                    // A one-off moved class is not part of the week.
                    slot(3, '12:00', '2026-11-20', '2026-11-20'),
                    slot(5, '19:00'),
                ],
                _count: { members: 31 },
            },
        ])
        const out = await run()
        expect(out.data).toEqual([
            expect.objectContaining({
                id: 'g1',
                gym: { id: 'h1', name: 'Зал 1' },
                memberCount: 31,
                week: [
                    { dayOfWeek: 1, startTime: '19:00' },
                    { dayOfWeek: 5, startTime: '19:00' },
                ],
            }),
        ])
        expect(out.data[0]).not.toHaveProperty('members')
        const include = prisma.group.findMany.mock.calls[0][0].include
        expect(include).not.toHaveProperty('members')
        expect(include).not.toHaveProperty('exceptions')
        expect(include.slots.where).toEqual({
            OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: expect.any(Date) } }],
        })
    })

    it("cuts ended slots at the club's date, not UTC's", async () => {
        jest.useFakeTimers({ now: new Date('2026-11-14T20:00:00.000Z') })
        try {
            const { prisma, run } = make('admin')
            await run()
            // 03:00 on 15 Nov in Tomsk: a slot that ended on the 14th is out.
            expect(
                prisma.group.findMany.mock.calls[0][0].include.slots.where,
            ).toEqual({
                OR: [
                    { effectiveUntil: null },
                    { effectiveUntil: { gte: new Date('2026-11-15T00:00:00.000Z') } },
                ],
            })
        } finally {
            jest.useRealTimers()
        }
    })
})
