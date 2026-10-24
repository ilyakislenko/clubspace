import { GetMyGroupsFeature } from './get-my-groups.feature'
import { GetMyGroupsHandler } from './get-my-groups.handler'

const group = (id: string) => ({
    id,
    name: `Group ${id}`,
    gym: null,
    coach: { id: 'u1', email: 'c@x.io', firstname: 'C', lastname: 'C' },
    coaches: [],
    slots: [],
    exceptions: [],
    _count: { members: 2 },
})

const makePrisma = (opts: {
    roleName: string | null
    ownerId?: string
    joinedGroupIds?: string[]
}) => ({
    groupCoach: {
        findMany: jest.fn().mockResolvedValue([{ group: group('g1') }]),
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
    },
    workspace: {
        findUnique: jest
            .fn()
            .mockResolvedValue({ ownerId: opts.ownerId ?? 'owner' }),
    },
})

const run = (prisma: any) =>
    new GetMyGroupsHandler(prisma).execute(new GetMyGroupsFeature('w1', 'u1'))

describe('GetMyGroupsHandler', () => {
    it('tags a group as coach for a member who still has a coaching role', async () => {
        const { data } = await run(makePrisma({ roleName: 'coach' }))
        expect(data.map((g) => [g.id, g.role])).toEqual([['g1', 'coach']])
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
})
