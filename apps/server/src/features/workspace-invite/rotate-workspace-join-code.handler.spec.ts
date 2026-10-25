jest.mock('../../environments/environment', () => ({
    environment: {
        appUrl: 'https://app.club.example',
        playStoreUrl: undefined,
        ruStoreUrl: undefined,
    },
}))
jest.mock('../../domains/workspace/join-qr', () => ({
    buildJoinQrPngDataUrl: jest.fn().mockResolvedValue('data:image/png;base64,QR'),
}))

import { ForbiddenError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { RotateWorkspaceJoinCodeFeature } from './rotate-workspace-join-code.feature'
import { RotateWorkspaceJoinCodeHandler } from './rotate-workspace-join-code.handler'

const build = () => {
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue({
                id: 'w1',
                name: 'Club',
                ownerId: 'owner',
                coachSeesAllGroups: false,
                joinAutoApprove: false,
            }),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const handler = new RotateWorkspaceJoinCodeHandler(
        prisma as never,
        new RbacService(prisma as never),
        audit as never,
    )
    return { handler, prisma, audit }
}

const run = (
    handler: RotateWorkspaceJoinCodeHandler,
    userId: string,
    roleName: string | null,
) =>
    handler.execute(
        new RotateWorkspaceJoinCodeFeature('w1', userId, roleName, false),
    )

describe('rotateWorkspaceJoinCode', () => {
    it.each(['coach', 'user'])('refuses a %s and changes nothing', async (role) => {
        const { handler, prisma, audit } = build()
        await expect(run(handler, 'u1', role)).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        expect(prisma.workspace.updateMany).not.toHaveBeenCalled()
        expect(audit.record).not.toHaveBeenCalled()
    })

    it('rotates for an admin: overwrites unconditionally and returns the new invite', async () => {
        const { handler, prisma } = build()
        const out = await run(handler, 'a1', 'admin')
        const written = prisma.workspace.updateMany.mock.calls[0][0]
        // No `joinCode: null` guard: the old code must be replaced.
        expect(written.where).toEqual({ id: 'w1' })
        expect(out.joinCode).toBe(written.data.joinCode)
        expect(out.joinUrl).toBe(
            `https://app.club.example/join/${written.data.joinCode}`,
        )
        expect(out.qrPngDataUrl).toBe('data:image/png;base64,QR')
    })

    it('lets the owner (no member row) and a head coach rotate', async () => {
        const { handler } = build()
        await expect(run(handler, 'owner', null)).resolves.toBeDefined()
        await expect(run(handler, 'h1', 'head_coach')).resolves.toBeDefined()
    })

    it('audits the rotation without putting the code in the journal', async () => {
        const { handler, audit } = build()
        await run(handler, 'a1', 'admin')
        expect(audit.record).toHaveBeenCalledTimes(1)
        const entry = audit.record.mock.calls[0][0]
        expect(entry).toEqual({
            action: 'workspace.rotateJoinCode',
            targetType: 'workspace',
            targetId: 'w1',
            workspaceId: 'w1',
            actorId: 'a1',
        })
    })
})
