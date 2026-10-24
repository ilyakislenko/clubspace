import { UpdateMeFeature } from './update-me.feature'
import { UpdateMeHandler } from './update-me.handler'
import { UpdateMeInputSchema } from './update-me.feature'

const userRow = (over: Record<string, unknown> = {}) => ({
    id: 'u1',
    email: 'yolo@mail.ru',
    firstname: 'Яна',
    lastname: null,
    profilePhotoUrl: null,
    language: 'RU',
    isSuperAdmin: false,
    createdAt: new Date('2026-06-30T00:00:00Z'),
    ...over,
})

const run = async (body: unknown, update = jest.fn().mockResolvedValue(userRow())) => {
    const prisma = { user: { update } }
    const payload = UpdateMeInputSchema.parse(body)
    const out = await new UpdateMeHandler(prisma as never).execute(
        new UpdateMeFeature(payload, 'u1'),
    )
    return { out, update }
}

describe('updateMe', () => {
    it('writes only the caller, only the fields sent, trimmed', async () => {
        const { update } = await run({ firstname: '  Яна  ' })
        expect(update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'u1' },
                data: { firstname: 'Яна' },
            }),
        )
    })

    it('clears a name sent as blank instead of storing an empty string', async () => {
        const { update } = await run({ firstname: 'Яна', lastname: '   ' })
        expect(update.mock.calls[0][0].data).toEqual({
            firstname: 'Яна',
            lastname: null,
        })
    })

    it('answers with the same shape as GET /me', async () => {
        const { out } = await run({ firstname: 'Яна' })
        expect(out).toEqual({
            id: 'u1',
            email: 'yolo@mail.ru',
            firstname: 'Яна',
            lastname: null,
            profilePhotoUrl: null,
            language: 'RU',
            isSuperAdmin: false,
            createdAt: '2026-06-30T00:00:00.000Z',
        })
    })

    it('rejects a name over 100 characters', () => {
        expect(() => UpdateMeInputSchema.parse({ firstname: 'я'.repeat(101) })).toThrow()
    })

    it('maps a vanished user to NotFound', async () => {
        const update = jest
            .fn()
            .mockRejectedValue(Object.assign(new Error('gone'), { code: 'P2025' }))
        await expect(run({ firstname: 'Яна' }, update)).rejects.toThrow(
            'Пользователь не найден',
        )
    })
})
