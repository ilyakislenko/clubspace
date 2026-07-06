import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { loadSessionForRead, loadSessionForWrite } from './session-access'

const groupSession = {
    id: 's1',
    workspaceId: 'w1',
    groupId: 'g1',
    slotId: null,
    workspaceEventId: null,
}
const eventSession = {
    id: 's2',
    workspaceId: 'w1',
    groupId: null,
    slotId: null,
    workspaceEventId: 'e1',
}

const prismaWith = (session: unknown) => ({
    attendanceSession: { findFirst: jest.fn().mockResolvedValue(session) },
})

const rbac = (over: Record<string, unknown> = {}) => ({
    assertCanWriteGroup: jest.fn().mockResolvedValue(undefined),
    canWriteAllGroups: jest.fn().mockReturnValue(false),
    canSeeAllGroups: jest.fn().mockReturnValue(false),
    ...over,
})

const ctx = { scope: 'coach_own_only' } as never

describe('loadSessionForWrite', () => {
    it('throws NotFound when the session is missing', async () => {
        await expect(
            loadSessionForWrite(
                prismaWith(null) as never,
                rbac() as never,
                ctx,
                'w1',
                'sX',
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('delegates a group session to assertCanWriteGroup', async () => {
        const r = rbac()
        await loadSessionForWrite(
            prismaWith(groupSession) as never,
            r as never,
            ctx,
            'w1',
            's1',
        )
        expect(r.assertCanWriteGroup).toHaveBeenCalledWith(ctx, 'g1')
    })

    it('allows an event session only with admin (write-all) scope', async () => {
        const admin = rbac({ canWriteAllGroups: jest.fn().mockReturnValue(true) })
        await expect(
            loadSessionForWrite(
                prismaWith(eventSession) as never,
                admin as never,
                ctx,
                'w1',
                's2',
            ),
        ).resolves.toMatchObject({ id: 's2' })
    })

    it('forbids an event session for a non-admin', async () => {
        await expect(
            loadSessionForWrite(
                prismaWith(eventSession) as never,
                rbac() as never,
                ctx,
                'w1',
                's2',
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })
})

describe('loadSessionForRead', () => {
    it('lets a see-all scope read anything without a group check', async () => {
        const r = rbac({ canSeeAllGroups: jest.fn().mockReturnValue(true) })
        await loadSessionForRead(
            prismaWith(eventSession) as never,
            r as never,
            ctx,
            'w1',
            's2',
        )
        expect(r.assertCanWriteGroup).not.toHaveBeenCalled()
    })

    it('checks group access for a scoped coach on a group session', async () => {
        const r = rbac()
        await loadSessionForRead(
            prismaWith(groupSession) as never,
            r as never,
            ctx,
            'w1',
            's1',
        )
        expect(r.assertCanWriteGroup).toHaveBeenCalledWith(ctx, 'g1')
    })

    it('forbids a scoped coach from reading an event session', async () => {
        await expect(
            loadSessionForRead(
                prismaWith(eventSession) as never,
                rbac() as never,
                ctx,
                'w1',
                's2',
            ),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })
})
