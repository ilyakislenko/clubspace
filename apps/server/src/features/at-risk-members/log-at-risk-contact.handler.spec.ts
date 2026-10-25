import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { LogAtRiskContactFeature } from './log-at-risk-contact.feature'
import { LogAtRiskContactHandler } from './log-at-risk-contact.handler'

jest.mock('../../domains/retention/load-workspace-risk')
import { loadWorkspaceRisk } from '../../domains/retention/load-workspace-risk'

const make = (over: { member?: unknown } = {}) => {
    const rbac = {
        resolveCoachScope: jest
            .fn()
            .mockResolvedValue({ scope: 'coach_own_only', userId: 'me' }),
        assertCanWriteMember: jest.fn().mockResolvedValue(undefined),
    }
    const prisma = {
        workspaceMember: {
            findFirst: jest
                .fn()
                .mockResolvedValue(over.member === undefined ? { id: 'm1' } : over.member),
        },
        memberRetentionContact: {
            create: jest.fn().mockImplementation(({ data }) =>
                Promise.resolve({
                    id: 'c1',
                    createdAt: new Date('2026-10-25T10:00:00Z'),
                    ...data,
                    contactedBy: { firstname: 'Иван', lastname: 'Тренер', email: 't@x.io' },
                }),
            ),
        },
    }
    return { rbac, prisma, handler: new LogAtRiskContactHandler(prisma as never, rbac as never) }
}

const run = (
    handler: LogAtRiskContactHandler,
    payload: { note?: string | null } = {},
    invoker = 'me',
    role = 'coach',
) =>
    handler.execute(new LogAtRiskContactFeature(payload, 'w1', 'u1', invoker, role, false))

beforeEach(() => {
    ;(loadWorkspaceRisk as jest.Mock)
        .mockReset()
        .mockResolvedValue([{ userId: 'u1', risk: { reason: 'lapsed', signals: ['lapsed', 'absent'] } }])
})

describe('LogAtRiskContactHandler', () => {
    it('refuses a coach outside the member groups and writes nothing', async () => {
        const { handler, rbac, prisma } = make()
        rbac.assertCanWriteMember.mockRejectedValueOnce(new ForbiddenError({ message: 'no' }))
        await expect(run(handler)).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.memberRetentionContact.create).not.toHaveBeenCalled()
    })

    it('404s when the target is not an ACTIVE member', async () => {
        const { handler, prisma } = make({ member: null })
        await expect(run(handler)).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.workspaceMember.findFirst.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            userId: 'u1',
            status: 'ACTIVE',
        })
        expect(prisma.memberRetentionContact.create).not.toHaveBeenCalled()
    })

    it('stores the server-side snapshot of reason and signals', async () => {
        const { handler, prisma } = make()
        const res = await run(handler, { note: 'позвонил' })
        expect(loadWorkspaceRisk).toHaveBeenCalledWith(
            prisma,
            expect.objectContaining({ workspaceId: 'w1', userIds: ['u1'] }),
        )
        expect(prisma.memberRetentionContact.create.mock.calls[0][0].data).toEqual({
            workspaceId: 'w1',
            userId: 'u1',
            contactedById: 'me',
            reason: 'lapsed',
            signals: ['lapsed', 'absent'],
            note: 'позвонил',
        })
        expect(res).toEqual({
            id: 'c1',
            userId: 'u1',
            at: '2026-10-25T10:00:00.000Z',
            byName: 'Иван Тренер',
            note: 'позвонил',
            reason: 'lapsed',
            signals: ['lapsed', 'absent'],
        })
    })

    it('stores no reason and no signals when the member is not at risk', async () => {
        ;(loadWorkspaceRisk as jest.Mock).mockResolvedValue([])
        const { handler, prisma } = make()
        await run(handler)
        const data = prisma.memberRetentionContact.create.mock.calls[0][0].data
        expect(data.reason).toBeNull()
        expect(data.signals).toEqual([])
    })

    it('stores an empty note as null', async () => {
        const { handler, prisma } = make()
        await run(handler, { note: '' })
        expect(prisma.memberRetentionContact.create.mock.calls[0][0].data.note).toBeNull()
    })

    it('lets the owner (no member row, admin scope) log a contact', async () => {
        const { handler, rbac, prisma } = make()
        rbac.resolveCoachScope.mockResolvedValue({ scope: 'admin', userId: 'owner1' })
        await run(handler, {}, 'owner1', 'admin')
        expect(prisma.memberRetentionContact.create.mock.calls[0][0].data.contactedById).toBe(
            'owner1',
        )
    })
})
