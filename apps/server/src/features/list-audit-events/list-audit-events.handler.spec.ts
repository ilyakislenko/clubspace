import { ForbiddenError } from '../../shared/errors/shared.errors'
import { ownGroupsWhere, RbacService } from '../../shared/services/rbac.service'
import { ListAuditEventsFeature } from './list-audit-events.feature'
import { ListAuditEventsHandler } from './list-audit-events.handler'

type Scope = 'admin' | 'coach_read_all' | 'coach_own_only'

// `groups` / `students`: what the database returns for ownGroupsWhere(caller).
const make = (scope: Scope, groups: string[] = [], students: string[] = []) => {
    const prisma = {
        group: {
            findMany: jest.fn().mockResolvedValue(groups.map((id) => ({ id }))),
        },
        groupMember: {
            findMany: jest
                .fn()
                .mockResolvedValue(students.map((userId) => ({ userId }))),
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
    const audit = { list: jest.fn().mockResolvedValue({ data: [], total: 0 }) }
    const handler = new ListAuditEventsHandler(audit as never, rbac)
    const run = () =>
        handler.execute(
            new ListAuditEventsFeature(
                { curPage: 1, perPage: 20 },
                'w1',
                'me',
                'coach',
                false,
            ),
        )
    return { prisma, audit, resolveCoachScope, run }
}

describe('ListAuditEventsHandler', () => {
    it('propagates a refusal from resolveCoachScope', async () => {
        const { audit, resolveCoachScope, run } = make('admin')
        resolveCoachScope.mockRejectedValueOnce(new ForbiddenError({ message: 'no' }))
        await expect(run()).rejects.toBeInstanceOf(ForbiddenError)
        expect(audit.list).not.toHaveBeenCalled()
    })

    it.each<Scope>(['admin', 'coach_read_all'])('shows %s the whole feed', async (scope) => {
        const { prisma, audit, run } = make(scope)
        await run()
        expect(audit.list.mock.calls[0][0].extraOr).toBeUndefined()
        expect(prisma.group.findMany).not.toHaveBeenCalled()
    })

    it('narrows coach_own_only to own groups and their students (direction groups included)', async () => {
        const { prisma, audit, run } = make(
            'coach_own_only',
            ['g-own', 'g-direction'],
            ['s1', 's2'],
        )
        await run()
        const ownOfClub = { workspaceId: 'w1', ...ownGroupsWhere('me') }
        expect(prisma.group.findMany.mock.calls[0][0].where).toEqual(ownOfClub)
        expect(prisma.groupMember.findMany.mock.calls[0][0].where).toEqual({
            group: ownOfClub,
        })
        expect(audit.list.mock.calls[0][0]).toMatchObject({
            workspaceId: 'w1',
            extraOr: [
                { actorId: 'me' },
                { targetType: { in: ['video', 'playlist', 'gym'] } },
                { targetType: 'group', targetId: { in: ['g-own', 'g-direction'] } },
                { targetType: 'member', targetId: { in: ['me', 's1', 's2'] } },
            ],
        })
    })

    it('never widens to every group when the coach has none', async () => {
        const { audit, run } = make('coach_own_only')
        await run()
        expect(audit.list.mock.calls[0][0].extraOr[2]).toEqual({
            targetType: 'group',
            targetId: { in: ['__none__'] },
        })
    })
})
