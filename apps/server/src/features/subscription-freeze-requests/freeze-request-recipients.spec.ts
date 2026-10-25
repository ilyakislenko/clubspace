import { findFreezeRequestDeciders } from './freeze-request-recipients'

const build = (coaches: string[], members: string[]) => {
    const db = {
        groupCoach: {
            findMany: jest
                .fn()
                .mockResolvedValue(coaches.map((userId) => ({ userId }))),
        },
        workspaceMember: {
            findMany: jest
                .fn()
                .mockResolvedValue(members.map((userId) => ({ userId }))),
        },
    }
    return db
}

const params = { workspaceId: 'w1', ownerId: 'owner', memberUserId: 'm1' }

describe('findFreezeRequestDeciders', () => {
    it('always includes the owner, then the matching staff, deduped', async () => {
        const db = build(['c1', 'c1'], ['a1', 'c1', 'owner'])
        const ids = await findFreezeRequestDeciders(db as never, params)
        expect(ids).toEqual(['owner', 'a1', 'c1'])
    })

    it('drops the requester', async () => {
        const db = build([], ['m1', 'a1'])
        const ids = await findFreezeRequestDeciders(db as never, {
            ...params,
            ownerId: 'm1',
        })
        expect(ids).toEqual(['a1'])
    })

    it('keeps a coach only while their role is still coach (demoted assistant dropped)', async () => {
        // The group assignment survives, but the member query (current role =
        // coach) no longer returns the demoted assistant.
        const db = build(['demoted'], [])
        const ids = await findFreezeRequestDeciders(db as never, params)
        expect(ids).toEqual(['owner'])
        const where = db.workspaceMember.findMany.mock.calls[0][0].where
        expect(where.status).toBe('ACTIVE')
        expect(where.OR[1]).toEqual({
            userId: { in: ['demoted'] },
            role: { name: 'coach' },
        })
    })
})
