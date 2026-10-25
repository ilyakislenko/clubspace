import { BadRequestError, ForbiddenError } from '../../shared/errors/shared.errors'
import { SyncGroupMembersFeature } from './sync-group-members.feature'
import { SyncGroupMembersHandler } from './sync-group-members.handler'

const build = (o: { denied?: boolean; assistant?: boolean } = {}) => {
    const tx = {
        group: { findUnique: jest.fn().mockResolvedValue({ coachId: 'c1' }) },
        user: {
            findMany: jest
                .fn()
                .mockResolvedValue([
                    { id: 'u1', firstname: 'Анна', lastname: 'Ким', email: 'a@x' },
                ]),
        },
        groupCoach: {
            findMany: jest
                .fn()
                .mockResolvedValue(o.assistant ? [{ userId: 'u1' }] : []),
        },
        workspaceMember: {
            findMany: jest
                .fn()
                .mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]),
        },
        groupMember: {
            findMany: jest.fn().mockResolvedValue([{ userId: 'u2' }]),
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        dropInBooking: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    }
    const prisma = { $transaction: jest.fn(async (cb: any) => cb(tx)) }
    const audit = { record: jest.fn() }
    const rbac = {
        resolveCoachScope: jest.fn().mockResolvedValue({}),
        assertCanWriteGroup: jest.fn().mockImplementation(async () => {
            if (o.denied) throw new ForbiddenError({ message: 'no' })
        }),
    }
    const handler = new SyncGroupMembersHandler(
        prisma as never,
        audit as never,
        rbac as never,
    )
    return { handler, tx, prisma }
}

const run = (handler: SyncGroupMembersHandler, userIds: string[]) =>
    handler.execute(
        new SyncGroupMembersFeature({ userIds }, 'w1', 'g1', 'coach', 'coach', false),
    )

describe('SyncGroupMembersHandler', () => {
    it('drops guest bookings only for the newly added members', async () => {
        const { handler, tx } = build()
        await expect(run(handler, ['u1', 'u2'])).resolves.toMatchObject({
            addedCount: 1,
            removedCount: 0,
        })
        expect(tx.dropInBooking.deleteMany).toHaveBeenCalledWith({
            where: { groupId: 'g1', userId: { in: ['u1'] } },
        })
    })

    it('leaves bookings alone when nobody is added', async () => {
        const { handler, tx } = build()
        await run(handler, ['u2'])
        expect(tx.dropInBooking.deleteMany).not.toHaveBeenCalled()
    })

    it('refuses to add an assistant coach as a student, naming them', async () => {
        const { handler, tx } = build({ assistant: true })
        const err = await run(handler, ['u1', 'u2']).catch((e) => e)
        expect(err).toBeInstanceOf(BadRequestError)
        expect(err.message).toBe(
            'Тренера нельзя добавить учеником в его же группу: Анна Ким',
        )
        expect(tx.groupMember.createMany).not.toHaveBeenCalled()
    })

    it('cleans a legacy coach-as-student row instead of failing the sync', async () => {
        const { handler, tx } = build({ assistant: true })
        // u1 is an assistant coach AND already a member (from before the rule).
        tx.groupMember.findMany.mockResolvedValue([
            { userId: 'u1' },
            { userId: 'u2' },
        ])
        await expect(run(handler, ['u1', 'u2'])).resolves.toMatchObject({
            addedCount: 0,
            removedCount: 1,
            memberCount: 1,
        })
        expect(tx.groupMember.deleteMany).toHaveBeenCalledWith({
            where: { groupId: 'g1', userId: { in: ['u1'] } },
        })
    })

    it('refuses a caller who cannot write the group', async () => {
        const { handler, prisma } = build({ denied: true })
        await expect(run(handler, ['u1'])).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })
})
