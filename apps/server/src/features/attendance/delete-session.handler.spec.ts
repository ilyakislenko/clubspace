import { BadRequestError } from '../../shared/errors/shared.errors'
import { DeleteSessionFeature } from './delete-session.feature'
import { DeleteSessionHandler } from './delete-session.handler'

const makePrisma = (session: unknown) => ({
    attendanceSession: {
        findFirst: jest.fn().mockResolvedValue(session),
        delete: jest.fn().mockResolvedValue({}),
    },
})

const makeRbac = () => ({
    resolveCoachScope: jest.fn().mockResolvedValue({
        scope: 'admin',
        userId: 'u1',
        workspaceId: 'w1',
        workspaceOwnerId: 'owner',
    }),
    assertCanWriteGroup: jest.fn().mockResolvedValue(undefined),
    canWriteAllGroups: jest.fn().mockReturnValue(true),
})

const run = (prisma: unknown) =>
    new DeleteSessionHandler(prisma as never, makeRbac() as never).execute(
        new DeleteSessionFeature('w1', 's1', 'u1', 'admin', false),
    )

describe('DeleteSessionHandler', () => {
    it('deletes a group session', async () => {
        const prisma = makePrisma({
            id: 's1',
            workspaceId: 'w1',
            groupId: 'g1',
            isPersonal: false,
        })
        await expect(run(prisma)).resolves.toEqual({ status: 'deleted' })
        expect(prisma.attendanceSession.delete).toHaveBeenCalledWith({
            where: { id: 's1' },
        })
    })

    it('refuses a personal session: it is cancelled through its request', async () => {
        const prisma = makePrisma({
            id: 's1',
            workspaceId: 'w1',
            groupId: null,
            isPersonal: true,
            coachId: 'u1',
        })
        await expect(run(prisma)).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.attendanceSession.delete).not.toHaveBeenCalled()
    })
})
