import { birthdateTurningOn } from '../../domains/birthdays/birthdays'
import { localDateInTz } from '../attendance/attendance-utils'
import { ForbiddenError } from '../../shared/errors/shared.errors'
import { ListBirthdaysTodayFeature } from './list-birthdays-today.feature'
import { ListBirthdaysTodayHandler } from './list-birthdays-today.handler'

const TZ = 'Asia/Tomsk'
const today = () => localDateInTz(new Date(), TZ)
// Born on today's month-day (a leap year on 29 February).
const bornYearsAgo = (years: number) =>
    new Date(`${birthdateTurningOn(today(), years)}T00:00:00.000Z`)
const KID_TURNS = Number(today().slice(0, 4)) - bornYearsAgo(7).getUTCFullYear()

const row = (id: string, o: { firstname: string; email: string | null; years: number }) => ({
    user: {
        id,
        firstname: o.firstname,
        lastname: null,
        email: o.email,
        profilePhotoUrl: null,
        dateOfBirth: bornYearsAgo(o.years),
    },
})

const ROWS = [
    row('kid', { firstname: 'Аня', email: null, years: 7 }),
    row('adult', { firstname: 'Борис', email: 'b@x.io', years: 33 }),
]

const setup = (o: { rows?: unknown[]; ownMembers?: string[] } = {}) => {
    const prisma = {
        workspace: { findUnique: jest.fn().mockResolvedValue({ timezone: TZ }) },
        workspaceMember: { findMany: jest.fn().mockResolvedValue(o.rows ?? ROWS) },
        groupMember: {
            findMany: jest.fn().mockResolvedValue([
                { userId: 'kid', group: { id: 'g-kids', name: 'Дети' } },
                { userId: 'adult', group: { id: 'g-a', name: 'Взрослые' } },
                { userId: 'adult', group: { id: 'g-b', name: 'ММА' } },
            ]),
        },
    }
    const rbac = {
        resolveCoachScope: jest.fn(async (p: { userId: string; roleName: string | null }) => {
            if (p.roleName === 'user') {
                throw new ForbiddenError({ message: 'Нужны права администратора клуба' })
            }
            return {
                scope:
                    p.roleName === 'coach'
                        ? 'coach_read_all'
                        : 'admin',
                userId: p.userId,
                workspaceId: 'w1',
                workspaceOwnerId: 'owner',
            }
        }),
        canWriteAllGroups: jest.fn((ctx: { scope: string }) => ctx.scope === 'admin'),
        ownGroupMemberIds: jest.fn().mockResolvedValue(o.ownMembers ?? ['kid']),
    }
    const run = (roleName: string | null) =>
        new ListBirthdaysTodayHandler(prisma as never, rbac as never).execute(
            new ListBirthdaysTodayFeature('w1', 'caller', roleName, false),
        )
    return { prisma, rbac, run }
}

describe('ListBirthdaysTodayHandler', () => {
    it('lists the club for a sport lead, sorted by name, age only for a child', async () => {
        const { run, rbac, prisma } = setup()
        const out = await run('head_coach')
        expect(out.date).toBe(today())
        expect(out.members).toEqual([
            {
                userId: 'kid',
                name: 'Аня',
                photoUrl: null,
                isDependent: true,
                turns: KID_TURNS,
                groups: [{ id: 'g-kids', name: 'Дети' }],
            },
            {
                userId: 'adult',
                name: 'Борис',
                photoUrl: null,
                isDependent: false,
                turns: null,
                groups: [
                    { id: 'g-a', name: 'Взрослые' },
                    { id: 'g-b', name: 'ММА' },
                ],
            },
        ])
        expect(rbac.ownGroupMemberIds).not.toHaveBeenCalled()
        expect(prisma.workspaceMember.findMany.mock.calls[0][0].where).not.toHaveProperty('userId')
    })

    it('limits a coach to the students of their own groups, even when coaches read every group', async () => {
        const { run, prisma } = setup({ rows: [ROWS[0]] })
        const out = await run('coach')
        expect(prisma.workspaceMember.findMany.mock.calls[0][0].where.userId).toEqual({
            in: ['kid'],
        })
        expect(out.members.map((m) => m.userId)).toEqual(['kid'])
        // Only their own groups are named.
        expect(prisma.groupMember.findMany.mock.calls[0][0].where.group).toEqual({
            workspaceId: 'w1',
            OR: [
                { coaches: { some: { userId: 'caller' } } },
                { direction: { managers: { some: { userId: 'caller' } } } },
            ],
        })
    })

    it('answers an empty list for a coach with no students, without reading members', async () => {
        const { run, prisma } = setup({ ownMembers: [] })
        await expect(run('coach')).resolves.toEqual({ date: today(), members: [] })
        expect(prisma.workspaceMember.findMany).not.toHaveBeenCalled()
    })

    it('answers an empty list when nobody has a birthday today', async () => {
        const { run, prisma } = setup({ rows: [] })
        await expect(run('admin')).resolves.toEqual({ date: today(), members: [] })
        expect(prisma.groupMember.findMany).not.toHaveBeenCalled()
    })

    it('refuses a student', async () => {
        const { run } = setup()
        await expect(run('user')).rejects.toBeInstanceOf(ForbiddenError)
    })
})
