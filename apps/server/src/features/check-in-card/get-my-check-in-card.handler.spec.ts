jest.mock('../../environments/environment', () => ({
    environment: { encryptionKey: 'test-encryption-secret' },
}))
jest.mock('./check-in-card-qr', () => ({
    buildCheckInCardPngDataUrl: jest.fn(async (card: string) => `data:image/png;base64,${card}`),
}))

import { NotFoundError } from '../../shared/errors/shared.errors'
import { verifyCheckInCard } from './check-in-card-utils'
import { GetMyCheckInCardFeature } from './get-my-check-in-card.feature'
import { GetMyCheckInCardHandler } from './get-my-check-in-card.handler'

const ME = '00000000-0000-4000-8000-000000000004'

const setup = (o: { member?: boolean; ownerId?: string } = {}) => {
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue({ ownerId: o.ownerId ?? 'owner' }),
        },
        workspaceMember: {
            findFirst: jest.fn().mockResolvedValue(o.member === false ? null : { id: 'm1' }),
        },
        user: {
            findUnique: jest.fn().mockResolvedValue({
                id: ME,
                firstname: 'Аня',
                lastname: 'Смирнова',
                email: null,
            }),
        },
    }
    const run = () =>
        new GetMyCheckInCardHandler(prisma as never).execute(
            new GetMyCheckInCardFeature('w1', ME),
        )
    return { prisma, run }
}

describe('GetMyCheckInCardHandler', () => {
    it('gives a member their signed card, its QR and the name', async () => {
        const { run, prisma } = setup()
        const out = await run()
        expect(verifyCheckInCard(out.card, 'test-encryption-secret')).toBe(ME)
        expect(out.qrPngDataUrl).toBe(`data:image/png;base64,${out.card}`)
        expect(out.name).toBe('Аня Смирнова')
        expect(prisma.workspaceMember.findFirst.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            userId: ME,
        })
    })

    it('gives the owner (no member row) a card', async () => {
        const { run } = setup({ member: false, ownerId: ME })
        await expect(run()).resolves.toMatchObject({ name: 'Аня Смирнова' })
    })

    it('is NotFound for someone with no member row who is not the owner', async () => {
        const { run, prisma } = setup({ member: false })
        await expect(run()).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.user.findUnique).not.toHaveBeenCalled()
    })
})
