import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { UpdateGroupFeature } from './update-group.feature'
import { UpdateGroupHandler } from './update-group.handler'

const OWNER = 'owner-1'

const build = (membership: unknown) => {
    const tx = {
        group: {
            update: jest.fn().mockResolvedValue({
                id: 'g1',
                name: 'Kids',
                gymId: 'gym1',
                coachId: OWNER,
            }),
        },
        groupCoach: {
            deleteMany: jest.fn().mockResolvedValue({}),
            upsert: jest.fn().mockResolvedValue({}),
        },
    }
    const prisma = {
        group: {
            findFirst: jest.fn().mockResolvedValue({
                id: 'g1',
                name: 'Kids',
                gymId: 'gym1',
                coachId: 'old-coach',
            }),
        },
        workspaceMember: {
            findFirst: jest.fn().mockResolvedValue(membership),
        },
        $transaction: jest.fn(async (fn: (c: typeof tx) => unknown) => fn(tx)),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const rbac = {
        resolveCoachScope: jest
            .fn()
            .mockResolvedValue({ scope: 'admin', workspaceOwnerId: OWNER }),
        assertCanWriteGroup: jest.fn().mockResolvedValue(undefined),
    }
    const handler = new UpdateGroupHandler(
        prisma as never,
        audit as never,
        rbac as never,
    )
    return { handler, tx }
}

const run = (handler: UpdateGroupHandler, coachId: string) =>
    handler.execute(
        new UpdateGroupFeature({ coachId }, 'w1', 'g1', 'admin1', 'admin', false),
    )

describe('updateGroup coach', () => {
    it('lets the owner without a member row become the primary coach', async () => {
        const { handler, tx } = build(null)
        const out = await run(handler, OWNER)
        expect(out.coachId).toBe(OWNER)
        expect(tx.groupCoach.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                create: { groupId: 'g1', userId: OWNER, role: 'primary' },
            }),
        )
    })

    it('still refuses a non-member who is not the owner', async () => {
        const { handler, tx } = build(null)
        await expect(run(handler, 'stranger')).rejects.toBeInstanceOf(
            NotFoundError,
        )
        expect(tx.group.update).not.toHaveBeenCalled()
    })

    it('still refuses a member without a coaching role', async () => {
        const { handler } = build({ role: { name: 'user' } })
        await expect(run(handler, 'student')).rejects.toBeInstanceOf(
            BadRequestError,
        )
    })
})
