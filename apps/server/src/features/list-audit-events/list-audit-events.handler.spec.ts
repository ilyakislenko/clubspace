import { ForbiddenError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { ListAuditEventsFeature } from './list-audit-events.feature'
import { ListAuditEventsHandler } from './list-audit-events.handler'

// A real RbacService over a one-club fake: who passes is decided by the role,
// ownership and super-admin flag the controller hands over.
const make = () => {
    const prisma = {
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue({ ownerId: 'owner', coachSeesAllGroups: true }),
        },
    }
    const audit = { list: jest.fn().mockResolvedValue({ data: [], total: 0 }) }
    const handler = new ListAuditEventsHandler(audit as never, new RbacService(prisma as never))
    const run = (userId: string, roleName: string | null, isSuperAdmin = false) =>
        handler.execute(
            new ListAuditEventsFeature(
                { curPage: 1, perPage: 20, actionPrefix: 'member.' },
                'w1',
                userId,
                roleName,
                isSuperAdmin,
            ),
        )
    return { audit, run }
}

describe('ListAuditEventsHandler', () => {
    it.each([
        ['the owner', 'owner', 'admin', false],
        ['an admin', 'u1', 'admin', false],
        ['the platform super admin', 'su', null, true],
    ] as const)('shows %s the whole feed', async (_, userId, role, su) => {
        const { audit, run } = make()
        await run(userId, role, su)
        expect(audit.list).toHaveBeenCalledWith({
            workspaceId: 'w1',
            curPage: 1,
            perPage: 20,
            actionPrefix: 'member.',
        })
    })

    it.each([
        ['a head coach', 'head_coach'],
        ['a coach', 'coach'],
    ])('refuses %s without reading the feed', async (_, role) => {
        const { audit, run } = make()
        await expect(run('u1', role)).rejects.toBeInstanceOf(ForbiddenError)
        expect(audit.list).not.toHaveBeenCalled()
    })
})
