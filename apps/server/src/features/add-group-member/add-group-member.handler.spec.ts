import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { AddGroupMemberFeature } from './add-group-member.feature'
import { AddGroupMemberHandler } from './add-group-member.handler'

const build = (
    o: { denied?: boolean; inClub?: boolean; assistant?: boolean } = {},
) => {
    const prisma = {
        group: {
            findFirst: jest.fn().mockResolvedValue({ id: 'g1', coachId: 'c1' }),
        },
        workspaceMember: {
            findFirst: jest
                .fn()
                .mockResolvedValue(o.inClub === false ? null : { id: 'm1' }),
        },
        groupCoach: {
            findFirst: jest
                .fn()
                .mockResolvedValue(o.assistant ? { userId: 'u1' } : null),
        },
        groupMember: {
            upsert: jest.fn().mockResolvedValue({
                groupId: 'g1',
                userId: 'u1',
                joinedAt: new Date('2026-10-24T00:00:00Z'),
            }),
        },
        dropInBooking: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    }
    const audit = { record: jest.fn() }
    const rbac = {
        resolveCoachScope: jest.fn().mockResolvedValue({}),
        assertCanWriteGroup: jest.fn().mockImplementation(async () => {
            if (o.denied) throw new ForbiddenError({ message: 'no' })
        }),
    }
    const handler = new AddGroupMemberHandler(
        prisma as never,
        audit as never,
        rbac as never,
    )
    return { handler, prisma }
}

const run = (handler: AddGroupMemberHandler) =>
    handler.execute(
        new AddGroupMemberFeature({ userId: 'u1' }, 'w1', 'g1', 'coach', 'coach', false),
    )

describe('AddGroupMemberHandler', () => {
    it('adds the member and drops their guest bookings for that group', async () => {
        const { handler, prisma } = build()
        await expect(run(handler)).resolves.toMatchObject({
            groupId: 'g1',
            userId: 'u1',
        })
        expect(prisma.dropInBooking.deleteMany).toHaveBeenCalledWith({
            where: { groupId: 'g1', userId: 'u1' },
        })
    })

    it('refuses a caller who cannot write the group', async () => {
        const { handler, prisma } = build({ denied: true })
        await expect(run(handler)).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.groupMember.upsert).not.toHaveBeenCalled()
    })

    it('refuses an assistant coach of the group as a student', async () => {
        const { handler, prisma } = build({ assistant: true })
        await expect(run(handler)).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.groupCoach.findFirst).toHaveBeenCalledWith({
            where: { groupId: 'g1', userId: 'u1' },
            select: { userId: true },
        })
        expect(prisma.groupMember.upsert).not.toHaveBeenCalled()
    })

    it('404s when the user is not in the club', async () => {
        const { handler, prisma } = build({ inClub: false })
        await expect(run(handler)).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.dropInBooking.deleteMany).not.toHaveBeenCalled()
    })
})
