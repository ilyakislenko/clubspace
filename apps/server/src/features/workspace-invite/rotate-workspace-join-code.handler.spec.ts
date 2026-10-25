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

import { environment } from '../../environments/environment'
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
        },
        workspaceJoinCode: {
            findUnique: jest.fn().mockResolvedValue({ code: 'OLD22222' }),
            update: jest.fn().mockResolvedValue({}),
        },
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const realtime = { invalidate: jest.fn() }
    const handler = new RotateWorkspaceJoinCodeHandler(
        prisma as never,
        new RbacService(prisma as never),
        audit as never,
        realtime as never,
    )
    return { handler, prisma, audit, realtime }
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
        const { handler, prisma, audit, realtime } = build()
        await expect(run(handler, 'u1', role)).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        expect(prisma.workspaceJoinCode.update).not.toHaveBeenCalled()
        expect(audit.record).not.toHaveBeenCalled()
        expect(realtime.invalidate).not.toHaveBeenCalled()
    })

    it('rotates for an admin: overwrites unconditionally and returns the new invite', async () => {
        const { handler, prisma } = build()
        const out = await run(handler, 'a1', 'admin')
        const written = prisma.workspaceJoinCode.update.mock.calls[0][0]
        // Keyed by the club alone: the old code is replaced, not kept.
        expect(written.where).toEqual({ workspaceId: 'w1' })
        expect(out.joinCode).toBe(written.data.code)
        expect(out.joinUrl).toBe(
            `https://app.club.example/join/${written.data.code}`,
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

    it('tells open invite screens to refetch the new code', async () => {
        const { handler, realtime } = build()
        await run(handler, 'a1', 'admin')
        expect(realtime.invalidate).toHaveBeenCalledWith('w1', ['invite'])
    })

    it('answers without a link or QR when APP_URL is not set', async () => {
        const { handler } = build()
        const env = environment as { appUrl: string | null }
        const before = env.appUrl
        env.appUrl = null
        try {
            const out = await run(handler, 'owner', null)
            expect(out.joinUrl).toBeNull()
            expect(out.qrPngDataUrl).toBeNull()
            expect(out.publicUrlNotice).toBe(
                'Публичный адрес приложения не настроен',
            )
        } finally {
            env.appUrl = before
        }
    })
})
