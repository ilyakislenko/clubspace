import { BadRequestError } from '../../shared/errors/shared.errors'
import { CreateGroupFeature } from './create-group.feature'
import { CreateGroupHandler } from './create-group.handler'

const OWNER = 'owner-1'

const build = (membership: unknown) => {
    const tx = {
        group: {
            create: jest.fn().mockResolvedValue({
                id: 'g1',
                name: 'Kids',
                gymId: 'gym1',
                coachId: OWNER,
            }),
        },
        groupCoach: { create: jest.fn().mockResolvedValue({}) },
    }
    const prisma = {
        gym: { findFirst: jest.fn().mockResolvedValue({ id: 'gym1' }) },
        workspaceMember: {
            findFirst: jest.fn().mockResolvedValue(membership),
            findMany: jest.fn().mockResolvedValue([]),
        },
        $transaction: jest.fn(async (fn: (c: typeof tx) => unknown) => fn(tx)),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const rbac = {
        resolveCoachScope: jest
            .fn()
            .mockResolvedValue({ scope: 'admin', workspaceOwnerId: OWNER }),
        assertCanCreateGroupAs: jest.fn(),
    }
    const handler = new CreateGroupHandler(
        prisma as never,
        audit as never,
        rbac as never,
    )
    return { handler, tx }
}

const run = (handler: CreateGroupHandler, coachId: string) =>
    handler.execute(
        new CreateGroupFeature(
            { name: 'Kids', gymId: 'gym1', coachId },
            'w1',
            'admin1',
            'admin',
            false,
        ),
    )

describe('createGroup coach', () => {
    it('lets the owner without a member row be the primary coach', async () => {
        const { handler, tx } = build(null)
        const out = await run(handler, OWNER)
        expect(out.coachId).toBe(OWNER)
        expect(tx.groupCoach.create).toHaveBeenCalledWith({
            data: { groupId: 'g1', userId: OWNER, role: 'primary' },
        })
    })

    it('still refuses a non-member who is not the owner', async () => {
        const { handler, tx } = build(null)
        await expect(run(handler, 'stranger')).rejects.toBeInstanceOf(
            BadRequestError,
        )
        expect(tx.group.create).not.toHaveBeenCalled()
    })

    it('still refuses a member without a coaching role', async () => {
        const { handler } = build({ role: { name: 'user' } })
        await expect(run(handler, 'student')).rejects.toBeInstanceOf(
            BadRequestError,
        )
    })
})
