jest.mock('../../environments/environment', () => ({
    environment: {
        appUrl: 'https://app.club.example',
        playStoreUrl: 'https://play.google.com/x',
        ruStoreUrl: undefined,
    },
}))
jest.mock('../../domains/workspace/join-qr', () => ({
    buildJoinQrPngDataUrl: jest.fn().mockResolvedValue('data:image/png;base64,QR'),
}))

import { buildJoinQrPngDataUrl } from '../../domains/workspace/join-qr'
import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { GetWorkspaceInviteFeature } from './get-workspace-invite.feature'
import { GetWorkspaceInviteHandler } from './get-workspace-invite.handler'

const build = (workspace: unknown = { id: 'w1', name: 'Club', ownerId: 'owner', coachSeesAllGroups: false, joinCode: 'ABCD2345', joinAutoApprove: true }) => {
    const prisma = {
        workspace: {
            // resolveCoachScope reads ownerId, ensureJoinCode reads joinCode,
            // the handler itself reads name/joinAutoApprove: one fixture row.
            findUnique: jest.fn().mockResolvedValue(workspace),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
    }
    // The real RbacService, so the refusal is the real one.
    const rbac = new RbacService(prisma as never)
    const handler = new GetWorkspaceInviteHandler(prisma as never, rbac)
    return { handler, prisma }
}

const run = (
    handler: GetWorkspaceInviteHandler,
    who: { userId: string; roleName: string | null; isSuperAdmin?: boolean },
) =>
    handler.execute(
        new GetWorkspaceInviteFeature(
            'w1',
            who.userId,
            who.roleName,
            who.isSuperAdmin ?? false,
        ),
    )

describe('getWorkspaceInvite', () => {
    beforeEach(() => jest.clearAllMocks())

    it('refuses a plain member', async () => {
        const { handler } = build()
        await expect(
            run(handler, { userId: 'u1', roleName: 'user' }),
        ).rejects.toBeInstanceOf(ForbiddenError)
        expect(buildJoinQrPngDataUrl).not.toHaveBeenCalled()
    })

    it('refuses a caller with no role at all', async () => {
        const { handler } = build()
        await expect(
            run(handler, { userId: 'u1', roleName: null }),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('lets the owner through although the owner has no member row', async () => {
        const { handler } = build()
        const out = await run(handler, { userId: 'owner', roleName: null })
        expect(out.joinCode).toBe('ABCD2345')
    })

    it('lets a coach read the code and QR', async () => {
        const { handler } = build()
        const out = await run(handler, { userId: 'c1', roleName: 'coach' })
        expect(out).toEqual({
            workspaceId: 'w1',
            workspaceName: 'Club',
            joinCode: 'ABCD2345',
            joinCodeDisplay: 'ABCD-2345',
            joinUrl: 'https://app.club.example/join/ABCD2345',
            qrPngDataUrl: 'data:image/png;base64,QR',
            joinAutoApprove: true,
            appLinks: {
                web: 'https://app.club.example',
                googlePlay: 'https://play.google.com/x',
                ruStore: null,
            },
        })
        expect(buildJoinQrPngDataUrl).toHaveBeenCalledWith(
            'https://app.club.example/join/ABCD2345',
        )
    })

    it('lets the platform super admin through', async () => {
        const { handler } = build()
        await expect(
            run(handler, { userId: 'sa', roleName: null, isSuperAdmin: true }),
        ).resolves.toMatchObject({ joinCode: 'ABCD2345' })
    })

    it('makes the code lazily for a club that has none', async () => {
        const { handler, prisma } = build({
            id: 'w1',
            name: 'Club',
            ownerId: 'owner',
            coachSeesAllGroups: false,
            joinCode: null,
            joinAutoApprove: false,
        })
        const out = await run(handler, { userId: 'owner', roleName: null })
        const written = prisma.workspace.updateMany.mock.calls[0][0]
        expect(written.where).toEqual({ id: 'w1', joinCode: null })
        expect(out.joinCode).toBe(written.data.joinCode)
        expect(out.joinCode).toMatch(/^[2-9A-Z]{8}$/)
    })

    it('404s on a missing club', async () => {
        // resolveCoachScope answers a missing club with 403 first; for the
        // owner/admin path it is the handler's own read that 404s.
        const { handler, prisma } = build()
        prisma.workspace.findUnique
            .mockResolvedValueOnce({ ownerId: 'owner', coachSeesAllGroups: false })
            .mockResolvedValueOnce(null)
        await expect(
            run(handler, { userId: 'owner', roleName: null }),
        ).rejects.toBeInstanceOf(NotFoundError)
    })
})
