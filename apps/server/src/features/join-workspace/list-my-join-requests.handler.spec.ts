import { ListMyJoinRequestsFeature } from './list-my-join-requests.feature'
import { ListMyJoinRequestsHandler } from './list-my-join-requests.handler'

const row = (status: string, id: string) => ({
    status,
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    workspace: { id, name: `Club ${id}`, key: `key-${id}` },
})

const build = (rows: unknown[]) => {
    const findMany = jest.fn().mockResolvedValue(rows)
    const handler = new ListMyJoinRequestsHandler({
        workspaceMember: { findMany },
    } as never)
    return { handler, findMany }
}

describe('listMyJoinRequests', () => {
    it("reads only the caller's non-active memberships of active clubs", async () => {
        const { handler, findMany } = build([])
        await handler.execute(new ListMyJoinRequestsFeature('u1'))
        const args = findMany.mock.calls[0][0]
        expect(args.where).toEqual({
            userId: 'u1',
            status: { in: ['INVITED', 'BLOCKED', 'SUSPENDED'] },
            workspace: { isActive: true },
        })
        expect(args.orderBy).toEqual({ createdAt: 'desc' })
        expect(args.take).toBe(20)
    })

    it('returns an empty list for a user with no requests', async () => {
        const { handler } = build([])
        await expect(
            handler.execute(new ListMyJoinRequestsFeature('u1')),
        ).resolves.toEqual({ data: [] })
    })

    it('maps INVITED to pending and BLOCKED/SUSPENDED to rejected', async () => {
        const { handler } = build([
            row('INVITED', 'a'),
            row('BLOCKED', 'b'),
            row('SUSPENDED', 'c'),
        ])
        const out = await handler.execute(new ListMyJoinRequestsFeature('u1'))
        expect(out.data.map((r) => r.status)).toEqual([
            'pending',
            'rejected',
            'rejected',
        ])
        expect(out.data[0]).toEqual({
            workspaceId: 'a',
            workspaceName: 'Club a',
            workspaceKey: 'key-a',
            status: 'pending',
            requestedAt: '2026-10-01T10:00:00.000Z',
        })
    })
})
