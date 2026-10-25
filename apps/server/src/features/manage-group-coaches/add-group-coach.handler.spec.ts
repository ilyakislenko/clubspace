import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { AddGroupCoachFeature } from './add-group-coach.feature'
import { AddGroupCoachHandler } from './add-group-coach.handler'

const OWNER = 'owner-1'

const build = (membership: unknown) => {
    const prisma = {
        workspaceMember: {
            findFirst: jest.fn().mockResolvedValue(membership),
        },
        groupMember: { deleteMany: jest.fn().mockReturnValue('del') },
        groupCoach: { upsert: jest.fn().mockReturnValue('ups') },
        $transaction: jest.fn().mockResolvedValue([]),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const rbac = {
        resolveCoachScope: jest
            .fn()
            .mockResolvedValue({ scope: 'admin', workspaceOwnerId: OWNER }),
        assertCanWriteGroup: jest.fn().mockResolvedValue(undefined),
    }
    const handler = new AddGroupCoachHandler(
        prisma as never,
        audit as never,
        rbac as never,
    )
    return { handler, prisma }
}

const run = (handler: AddGroupCoachHandler, userId: string) =>
    handler.execute(
        new AddGroupCoachFeature({ userId }, 'w1', 'g1', 'admin1', 'admin', false),
    )

describe('addGroupCoach', () => {
    it('lets the owner without a member row be an assistant', async () => {
        const { handler, prisma } = build(null)
        const out = await run(handler, OWNER)
        expect(out).toEqual({ groupId: 'g1', userId: OWNER, role: 'assistant' })
        expect(prisma.groupCoach.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                create: { groupId: 'g1', userId: OWNER, role: 'assistant' },
            }),
        )
    })

    it('still refuses a non-member who is not the owner', async () => {
        const { handler, prisma } = build(null)
        await expect(run(handler, 'stranger')).rejects.toBeInstanceOf(
            NotFoundError,
        )
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('still refuses a member without a coaching role', async () => {
        const { handler } = build({ role: { name: 'user' } })
        await expect(run(handler, 'student')).rejects.toBeInstanceOf(
            BadRequestError,
        )
    })
})
