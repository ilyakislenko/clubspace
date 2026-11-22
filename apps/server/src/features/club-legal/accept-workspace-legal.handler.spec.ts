jest.mock('../../environments/environment', () => ({
    environment: { billing: { legal: { acceptGraceDays: 14 } } },
}))

import {
    ConflictError,
    ForbiddenError,
} from '../../shared/errors/shared.errors'
import { AcceptWorkspaceLegalFeature } from './accept-workspace-legal.feature'
import { AcceptWorkspaceLegalHandler } from './accept-workspace-legal.handler'

const CURRENT = { offerVersion: '2026-12-01', dpaVersion: '2026-11-01' }
const PENDING = {
    current: CURRENT,
    ownerId: 'owner',
    latest: {
        offerVersion: '2026-11-01',
        dpaVersion: '2026-11-01',
        acceptedAt: new Date('2026-11-02T00:00:00.000Z'),
        source: 'SIGNUP',
        userName: 'Иван Петров',
    },
    status: { upToDate: false, acceptBy: new Date('2026-12-15T00:00:00.000Z'), required: false },
}
const ACCEPTED = {
    ...PENDING,
    latest: {
        ...CURRENT,
        acceptedAt: new Date('2026-12-03T00:00:00.000Z'),
        source: 'OWNER',
        userName: 'Иван Петров',
    },
    status: { upToDate: true, acceptBy: null, required: false },
}

const build = (o: { state?: unknown } = {}) => {
    // Club-admin gate first (owner/admin); a head coach resolves to the
    // sport-lead 'admin' scope and is still refused there.
    const rbac = {
        resolveCoachScope: jest
            .fn()
            .mockImplementation(async (p: { userId: string; workspaceId: string }) => ({
                scope: 'admin',
                userId: p.userId,
                workspaceId: p.workspaceId,
                workspaceOwnerId: 'owner',
            })),
        canWriteAllGroups: jest.fn().mockReturnValue(true),
    }
    const legal = {
        getState: jest
            .fn()
            .mockResolvedValueOnce(o.state ?? PENDING)
            .mockResolvedValue(ACCEPTED),
        accept: jest.fn().mockResolvedValue({ id: 'acc-1' }),
    }
    const handler = new AcceptWorkspaceLegalHandler(rbac as never, legal as never)
    return { handler, legal }
}

const run = (
    handler: AcceptWorkspaceLegalHandler,
    userId = 'owner',
    versions = CURRENT,
    isSuperAdmin = false,
    roleName = 'admin',
) =>
    handler.execute(
        new AcceptWorkspaceLegalFeature(
            versions,
            'w1',
            userId,
            roleName,
            isSuperAdmin,
            '10.0.0.1',
            'Safari',
        ),
    )

describe('AcceptWorkspaceLegalHandler', () => {
    it('refuses a head coach before reading anything, even with every group in scope', async () => {
        const { handler, legal } = build()
        await expect(
            run(handler, 'hc-1', CURRENT, false, 'head_coach'),
        ).rejects.toThrow('только его владелец')
        expect(legal.getState).not.toHaveBeenCalled()
    })

    it('lets the owner accept, whatever their member row says', async () => {
        const { handler, legal } = build()
        await run(handler, 'owner', CURRENT, false, 'head_coach')
        expect(legal.accept).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 'owner', source: 'OWNER' }),
        )
    })

    it('refuses an admin who is not the owner, and a platform admin', async () => {
        for (const [userId, superAdmin] of [
            ['admin-2', false],
            ['platform', true],
        ] as const) {
            const { handler, legal } = build()
            const err = await run(handler, userId, CURRENT, superAdmin).catch((e) => e)
            expect(err).toBeInstanceOf(ForbiddenError)
            expect(err.message).toContain('только его владелец')
            // Past the club-admin gate; refused by the owner-only check.
            expect(legal.getState).toHaveBeenCalled()
            expect(legal.accept).not.toHaveBeenCalled()
        }
    })

    it('refuses an edition that is no longer current', async () => {
        const { handler, legal } = build()
        await expect(
            run(handler, 'owner', { ...CURRENT, offerVersion: '2026-11-01' }),
        ).rejects.toBeInstanceOf(ConflictError)
        expect(legal.accept).not.toHaveBeenCalled()
    })

    it('records the owner’s acceptance with where it came from', async () => {
        const { handler, legal } = build()
        const out = await run(handler)
        expect(legal.accept).toHaveBeenCalledWith({
            workspaceId: 'w1',
            userId: 'owner',
            source: 'OWNER',
            ip: '10.0.0.1',
            userAgent: 'Safari',
        })
        expect(out).toEqual({
            ...CURRENT,
            graceDays: 14,
            upToDate: true,
            acceptBy: null,
            required: false,
            accepted: {
                ...CURRENT,
                acceptedAt: '2026-12-03T00:00:00.000Z',
                source: 'OWNER',
                userName: 'Иван Петров',
            },
            canAccept: true,
        })
    })

    it('records nothing twice', async () => {
        const { handler, legal } = build({ state: ACCEPTED })
        const out = await run(handler)
        expect(legal.accept).not.toHaveBeenCalled()
        expect(out.upToDate).toBe(true)
    })
})
