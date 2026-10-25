import { GetMyGroupsFeature } from './get-my-groups.feature'
import { GetMyGroupsHandler } from './get-my-groups.handler'

const group = (id: string, gym: any = null) => ({
    id,
    name: `Group ${id}`,
    gym,
    coachId: 'u1',
    coach: {
        id: 'u1',
        email: 'c@x.io',
        firstname: 'C',
        lastname: 'C',
        phone: '+79528849420',
    },
    coaches: [
        {
            role: 'primary',
            user: {
                id: 'u1',
                email: 'c@x.io',
                firstname: 'C',
                lastname: 'C',
            },
        },
    ],
    slots: [],
    exceptions: [],
    _count: { members: 2 },
})

const makePrisma = (opts: {
    roleName: string | null
    ownerId?: string
    joinedGroupIds?: string[]
    coachGym?: any
    coachIsActiveMember?: boolean
}) => ({
    groupCoach: {
        findMany: jest.fn().mockResolvedValue([{ group: group('g1', opts.coachGym) }]),
    },
    groupMember: {
        findMany: jest
            .fn()
            .mockResolvedValue(
                (opts.joinedGroupIds ?? []).map((id) => ({ group: group(id) })),
            ),
    },
    workspaceMember: {
        findFirst: jest
            .fn()
            .mockResolvedValue(
                opts.roleName ? { role: { name: opts.roleName } } : null,
            ),
        findMany: jest
            .fn()
            .mockResolvedValue(
                (opts.coachIsActiveMember ?? true) ? [{ userId: 'u1' }] : [],
            ),
    },
    workspace: {
        findUnique: jest
            .fn()
            .mockResolvedValue({
                ownerId: opts.ownerId ?? 'owner',
                timezone: 'Asia/Yekaterinburg',
            }),
    },
})

const run = (prisma: any) =>
    new GetMyGroupsHandler(prisma).execute(new GetMyGroupsFeature('w1', 'u1'))

describe('GetMyGroupsHandler', () => {
    it('tags a group as coach for a member who still has a coaching role', async () => {
        const { data } = await run(makePrisma({ roleName: 'coach' }))
        expect(data.map((g) => [g.id, g.role])).toEqual([['g1', 'coach']])
    })

    it('exposes the phone of a coach who is still an active member', async () => {
        const prisma = makePrisma({ roleName: 'coach' })
        const { data } = await run(prisma)
        expect(data[0].coach.phone).toBe('+79528849420')
        expect(prisma.workspaceMember.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            userId: { in: ['u1'] },
            status: 'ACTIVE',
        })
    })

    it('hides the phone of a coach who was removed from the club', async () => {
        const { data } = await run(
            makePrisma({
                roleName: 'coach',
                ownerId: 'someone-else',
                coachIsActiveMember: false,
            }),
        )
        expect(data[0].coach.phone).toBeNull()
        expect(data[0].coach.firstname).toBe('C')
    })

    it('shows the phone of an owner who coaches (no member row)', async () => {
        const prisma = makePrisma({
            roleName: null,
            ownerId: 'u1',
            coachIsActiveMember: false,
        })
        const { data } = await run(prisma)
        expect(data[0].coach.phone).toBe('+79528849420')
        expect(prisma.workspaceMember.findMany).not.toHaveBeenCalled()
    })

    it('does not expose phones in the coaches list', async () => {
        const { data } = await run(makePrisma({ roleName: 'coach' }))
        expect(data[0].coaches[0]).not.toHaveProperty('phone')
    })

    it('tags a group as coach for the workspace owner (no member row)', async () => {
        const { data } = await run(
            makePrisma({ roleName: null, ownerId: 'u1' }),
        )
        expect(data.map((g) => g.role)).toEqual(['coach'])
    })

    it('drops stale GroupCoach rows once the member was demoted to user', async () => {
        const { data } = await run(makePrisma({ roleName: 'user' }))
        expect(data).toEqual([])
    })

    it('keeps a demoted coach as a student of groups they joined', async () => {
        const { data } = await run(
            makePrisma({ roleName: 'user', joinedGroupIds: ['g1', 'g2'] }),
        )
        expect(data.map((g) => [g.id, g.role])).toEqual([
            ['g1', 'student'],
            ['g2', 'student'],
        ])
    })

    it('uses the workspace timezone for a group without a gym', async () => {
        const { data } = await run(makePrisma({ roleName: 'coach' }))
        expect(data[0]!.timezone).toBe('Asia/Yekaterinburg')
    })

    it('uses the gym timezone when the gym has one', async () => {
        const gym = {
            id: 'gym1',
            name: 'Gym',
            address: 'A',
            timezone: 'Asia/Vladivostok',
        }
        const { data } = await run(
            makePrisma({ roleName: 'coach', coachGym: gym }),
        )
        expect(data[0]!.timezone).toBe('Asia/Vladivostok')
        expect(data[0]!.gym).toEqual({ id: 'gym1', name: 'Gym', address: 'A' })
    })

    it('falls back to the workspace timezone when the gym has none', async () => {
        const gym = { id: 'gym1', name: 'Gym', address: 'A', timezone: null }
        const { data } = await run(
            makePrisma({ roleName: 'coach', coachGym: gym }),
        )
        expect(data[0]!.timezone).toBe('Asia/Yekaterinburg')
    })
})
