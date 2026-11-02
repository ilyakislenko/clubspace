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

const personalSession = {
    id: 's3',
    workspaceId: 'w1',
    groupId: null,
    slotId: null,
    workspaceEventId: null,
    isPersonal: true,
    coachId: 'coach1',
}

const prismaWith = (session: unknown) => ({
    attendanceSession: { findFirst: jest.fn().mockResolvedValue(session) },
})

const rbac = (over: Record<string, unknown> = {}) => ({
    assertCanWriteGroup: jest.fn().mockResolvedValue(undefined),
    assertCanMarkClass: jest.fn().mockResolvedValue(undefined),
    canWriteAllGroups: jest.fn().mockReturnValue(false),
    canSeeAllGroups: jest.fn().mockReturnValue(false),
    ...over,
})

const slotSession = {
    ...groupSession,
    slotId: 'slot1',
    occurrenceKey: 'slot:slot1:2026-07-02',
}

const ctx = { scope: 'coach_own_only', userId: 'coach1' } as never
const otherCtx = { scope: 'coach_own_only', userId: 'coach2' } as never

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

    it('delegates an ad-hoc group session to assertCanMarkClass without a key', async () => {
        const r = rbac()
        await loadSessionForWrite(
            prismaWith(groupSession) as never,
            r as never,
            ctx,
            'w1',
            's1',
        )
        expect(r.assertCanMarkClass).toHaveBeenCalledWith(ctx, 'g1', null)
        expect(r.assertCanWriteGroup).not.toHaveBeenCalled()
    })

    it('passes the occurrence key of a slot session to assertCanMarkClass', async () => {
        const r = rbac()
        await loadSessionForWrite(
            prismaWith(slotSession) as never,
            r as never,
            ctx,
            'w1',
            's1',
        )
        expect(r.assertCanMarkClass).toHaveBeenCalledWith(
            ctx,
            'g1',
            'slot:slot1:2026-07-02',
        )
    })

    it("'manage' access requires assertCanWriteGroup (no substitute)", async () => {
        const r = rbac()
        await loadSessionForWrite(
            prismaWith(slotSession) as never,
            r as never,
            ctx,
            'w1',
            's1',
            'manage',
        )
        expect(r.assertCanWriteGroup).toHaveBeenCalledWith(ctx, 'g1')
        expect(r.assertCanMarkClass).not.toHaveBeenCalled()
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

describe('personal sessions', () => {
    it('is writable by its own coach without a group check', async () => {
        const r = rbac()
        await expect(
            loadSessionForWrite(
                prismaWith(personalSession) as never,
                r as never,
                ctx,
                'w1',
                's3',
            ),
        ).resolves.toMatchObject({ id: 's3' })
        expect(r.assertCanWriteGroup).not.toHaveBeenCalled()
    })

    it('is writable by an admin', async () => {
        const admin = rbac({ canWriteAllGroups: jest.fn().mockReturnValue(true) })
        await expect(
            loadSessionForWrite(
                prismaWith(personalSession) as never,
                admin as never,
                otherCtx,
                'w1',
                's3',
            ),
        ).resolves.toMatchObject({ id: 's3' })
    })

    it('hides it from another coach with NotFound', async () => {
        await expect(
            loadSessionForWrite(
                prismaWith(personalSession) as never,
                rbac() as never,
                otherCtx,
                'w1',
                's3',
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('is readable by an admin and by its own coach, not by another coach', async () => {
        const admin = rbac({ canWriteAllGroups: jest.fn().mockReturnValue(true) })
        await expect(
            loadSessionForRead(
                prismaWith(personalSession) as never,
                admin as never,
                otherCtx,
                'w1',
                's3',
            ),
        ).resolves.toMatchObject({ id: 's3' })
        await expect(
            loadSessionForRead(
                prismaWith(personalSession) as never,
                rbac() as never,
                ctx,
                'w1',
                's3',
            ),
        ).resolves.toMatchObject({ id: 's3' })
        await expect(
            loadSessionForRead(
                prismaWith(personalSession) as never,
                rbac() as never,
                otherCtx,
                'w1',
                's3',
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('does not open it to a coach who merely sees all groups', async () => {
        const seeAll = rbac({ canSeeAllGroups: jest.fn().mockReturnValue(true) })
        await expect(
            loadSessionForRead(
                prismaWith(personalSession) as never,
                seeAll as never,
                otherCtx,
                'w1',
                's3',
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
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
            prismaWith(slotSession) as never,
            r as never,
            ctx,
            'w1',
            's1',
        )
        expect(r.assertCanMarkClass).toHaveBeenCalledWith(
            ctx,
            'g1',
            'slot:slot1:2026-07-02',
        )
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

    it('the event’s own coach marks and reads it; deleting it stays admin-only', async () => {
        const led = { ...eventSession, coachId: 'coach1', workspaceEvent: { coachId: 'coach1' } }
        await expect(
            loadSessionForWrite(prismaWith(led) as never, rbac() as never, ctx, 'w1', 's2'),
        ).resolves.toMatchObject({ id: 's2' })
        await expect(
            loadSessionForRead(prismaWith(led) as never, rbac() as never, ctx, 'w1', 's2'),
        ).resolves.toMatchObject({ id: 's2' })
        await expect(
            loadSessionForWrite(prismaWith(led) as never, rbac() as never, ctx, 'w1', 's2', 'manage'),
        ).rejects.toBeInstanceOf(ForbiddenError)
        await expect(
            loadSessionForWrite(prismaWith(led) as never, rbac() as never, otherCtx, 'w1', 's2'),
        ).rejects.toBeInstanceOf(ForbiddenError)
        await expect(
            loadSessionForRead(prismaWith(led) as never, rbac() as never, otherCtx, 'w1', 's2'),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('follows the event’s coach now, not the one the session was opened by', async () => {
        // Opened by coach1; the event was then given to coach2.
        const handedOver = { ...eventSession, coachId: 'coach1', workspaceEvent: { coachId: 'coach2' } }
        for (const load of [loadSessionForWrite, loadSessionForRead]) {
            await expect(
                load(prismaWith(handedOver) as never, rbac() as never, ctx, 'w1', 's2'),
            ).rejects.toBeInstanceOf(ForbiddenError)
            await expect(
                load(prismaWith(handedOver) as never, rbac() as never, otherCtx, 'w1', 's2'),
            ).resolves.toMatchObject({ id: 's2', eventCoachId: 'coach2' })
        }
    })

    it('a session of a deleted event is the admins’ alone', async () => {
        const orphaned = { ...eventSession, workspaceEventId: null, coachId: 'coach1', workspaceEvent: null }
        for (const load of [loadSessionForWrite, loadSessionForRead]) {
            await expect(
                load(prismaWith(orphaned) as never, rbac() as never, ctx, 'w1', 's2'),
            ).rejects.toBeInstanceOf(ForbiddenError)
        }
        const admin = rbac({ canWriteAllGroups: jest.fn().mockReturnValue(true) })
        await expect(
            loadSessionForWrite(prismaWith(orphaned) as never, admin as never, ctx, 'w1', 's2'),
        ).resolves.toMatchObject({ id: 's2' })
    })
})
