jest.mock('../../environments/environment', () => ({
    environment: { encryptionKey: 'test-encryption-secret' },
}))
jest.mock('./check-in-card-qr', () => ({
    buildCheckInCardPngDataUrl: jest.fn(async () => 'data:image/png;base64,QR'),
}))

import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { verifyCheckInCard } from './check-in-card-utils'
import { GetMemberCheckInCardFeature } from './get-member-check-in-card.feature'
import { GetMemberCheckInCardHandler } from './get-member-check-in-card.handler'

const KID = '00000000-0000-4000-8000-000000000004'

const setup = (o: { role?: string | null; ownerId?: string } = {}) => {
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue({ type: 'GRAPPLING' }),
        },
        workspaceMember: {
            findFirst: jest
                .fn()
                .mockResolvedValue(
                    o.role === null ? null : { role: { name: o.role ?? 'user' } },
                ),
        },
        user: {
            findUnique: jest.fn().mockResolvedValue({
                id: KID,
                firstname: 'Аня',
                lastname: 'Смирнова',
                email: null,
            }),
        },
    }
    const rbac = {
        resolveCoachScope: jest.fn(async (p: { userId: string; roleName: string | null }) => {
            if (p.roleName === 'user') throw new ForbiddenError({ message: 'no' })
            return {
                scope: p.roleName === 'coach' ? 'coach_own_only' : 'admin',
                userId: p.userId,
                workspaceId: 'w1',
                workspaceOwnerId: o.ownerId ?? 'owner',
            }
        }),
        canWriteAllGroups: jest.fn((ctx: { scope: string }) => ctx.scope === 'admin'),
        clubVocabulary: jest.fn(),
    }
    const run = (invoker = 'admin1', roleName: string | null = 'admin') =>
        new GetMemberCheckInCardHandler(prisma as never, rbac as never).execute(
            new GetMemberCheckInCardFeature('w1', KID, invoker, roleName, false),
        )
    return { prisma, run }
}

describe('GetMemberCheckInCardHandler', () => {
    it('gives a sport lead the member card to print', async () => {
        const { run } = setup()
        const out = await run('hc1', 'head_coach')
        expect(verifyCheckInCard(out.card, 'test-encryption-secret')).toBe(KID)
        expect(out).toMatchObject({ name: 'Аня Смирнова', qrPngDataUrl: 'data:image/png;base64,QR' })
    })

    it('refuses a coach', async () => {
        const { run, prisma } = setup()
        await expect(run('c1', 'coach')).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.workspaceMember.findFirst).not.toHaveBeenCalled()
    })

    it('refuses a head coach on a staff target', async () => {
        const { run, prisma } = setup({ role: 'coach' })
        await expect(run('hc1', 'head_coach')).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.user.findUnique).not.toHaveBeenCalled()
    })

    it('lets a club admin print a staff card', async () => {
        const { run } = setup({ role: 'coach' })
        await expect(run('admin1', 'admin')).resolves.toMatchObject({ name: 'Аня Смирнова' })
    })

    it('treats the owner as staff (no member row): admin yes, head coach no', async () => {
        await expect(setup({ role: null, ownerId: KID }).run('admin1', 'admin')).resolves.toBeDefined()
        await expect(
            setup({ role: null, ownerId: KID }).run('hc1', 'head_coach'),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('is NotFound for someone outside the club', async () => {
        const { run } = setup({ role: null })
        await expect(run()).rejects.toBeInstanceOf(NotFoundError)
    })
})
