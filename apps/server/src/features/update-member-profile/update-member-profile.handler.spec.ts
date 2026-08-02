import { NotFoundError } from '../../shared/errors/shared.errors'
import { UpdateMemberProfileFeature } from './update-member-profile.feature'
import { UpdateMemberProfileHandler } from './update-member-profile.handler'

const makePrisma = (over: {
    membership?: { id: string } | null
    ownerId?: string | null
} = {}) => ({
    workspaceMember: {
        findFirst: jest
            .fn()
            .mockResolvedValue(
                over.membership === undefined ? { id: 'm1' } : over.membership,
            ),
    },
    workspace: {
        findUnique: jest
            .fn()
            .mockResolvedValue({ ownerId: over.ownerId ?? 'someone-else' }),
    },
    user: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({
            id: 'u1',
            email: 'u1@x.io',
            firstname: 'Иван',
            lastname: 'Иванов',
        }),
    },
})

const makeAudit = () => ({ record: jest.fn().mockResolvedValue(undefined) })
const makeRealtime = () => ({ invalidate: jest.fn() })

const run = (prisma: any, payload: any = { firstname: 'Иван' }) =>
    new UpdateMemberProfileHandler(
        prisma as any,
        makeAudit() as any,
        makeRealtime() as any,
    ).execute(new UpdateMemberProfileFeature(payload, 'w1', 'u1', 'admin1'))

describe('UpdateMemberProfileHandler', () => {
    it('updates a normal member', async () => {
        const prisma = makePrisma({ membership: { id: 'm1' } })
        const result = await run(prisma)
        expect(prisma.user.update).toHaveBeenCalledTimes(1)
        expect(result.firstname).toBe('Иван')
    })

    it('allows editing the workspace owner even without a membership row', async () => {
        // Owner has no WorkspaceMember row in the normal creation flow.
        const prisma = makePrisma({ membership: null, ownerId: 'u1' })
        const result = await run(prisma)
        expect(prisma.user.update).toHaveBeenCalledTimes(1)
        expect(result.lastname).toBe('Иванов')
    })

    it('rejects a user who is neither a member nor the owner', async () => {
        const prisma = makePrisma({ membership: null, ownerId: 'someone-else' })
        await expect(run(prisma)).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.user.update).not.toHaveBeenCalled()
    })
})
