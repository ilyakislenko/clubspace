import { ForbiddenError } from '../../shared/errors/shared.errors'
import { ownGroupsWhere, RbacService } from '../../shared/services/rbac.service'
import { ListGroupsFeature } from './list-groups.feature'
import { ListGroupsHandler } from './list-groups.handler'

type Scope = 'admin' | 'coach_read_all' | 'coach_own_only'

const make = (scope: Scope) => {
    const prisma = { group: { findMany: jest.fn().mockResolvedValue([]) } }
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
})
