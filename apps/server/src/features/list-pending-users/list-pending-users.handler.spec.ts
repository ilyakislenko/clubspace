import { ListPendingUsersFeature } from './list-pending-users.feature'
import { ListPendingUsersHandler } from './list-pending-users.handler'

const ACCOUNT_CREATED = new Date('2025-11-01T08:00:00Z')
const ASKED = new Date('2026-11-14T09:30:00Z')
const SEEN = new Date('2026-11-14T10:00:00Z')

const build = (rows: unknown[]) => {
    const prisma = {
        workspaceMember: { findMany: jest.fn().mockResolvedValue(rows) },
    }
    return { prisma, handler: new ListPendingUsersHandler(prisma as never) }
}

describe('ListPendingUsersHandler', () => {
    it('lists the INVITED rows of the club, newest first', async () => {
        const { prisma, handler } = build([])
        await expect(handler.execute(new ListPendingUsersFeature('w1'))).resolves.toEqual({
            data: [],
            total: 0,
        })
        const args = prisma.workspaceMember.findMany.mock.calls[0][0]
        expect(args.where).toEqual({ workspaceId: 'w1', status: 'INVITED' })
        expect(args.orderBy).toEqual({ createdAt: 'desc' })
    })

    it('dates the request by the membership row, not the account', async () => {
        const { handler } = build([
            {
                id: 'm1',
                createdAt: ASKED,
                user: {
                    id: 'u1',
                    email: 'ann@b.com',
                    firstname: 'Анна',
                    lastname: null,
                    createdAt: ACCOUNT_CREATED,
                    lastSeenAt: SEEN,
                },
            },
        ])
        await expect(handler.execute(new ListPendingUsersFeature('w1'))).resolves.toEqual({
            data: [
                {
                    userId: 'u1',
                    email: 'ann@b.com',
                    firstname: 'Анна',
                    lastname: null,
                    createdAt: ASKED.toISOString(),
                    lastSeenAt: SEEN.toISOString(),
                },
            ],
            total: 1,
        })
    })
})
