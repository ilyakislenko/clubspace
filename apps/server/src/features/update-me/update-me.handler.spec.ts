import { UpdateMeFeature, UpdateMeInputSchema } from './update-me.feature'
import { UpdateMeHandler } from './update-me.handler'

const BASE_ROW = {
    id: 'u1',
    email: 'yolo@mail.ru',
    firstname: null as string | null,
    lastname: null as string | null,
    profilePhotoUrl: null,
    language: 'RU',
    isSuperAdmin: false,
    createdAt: new Date('2026-06-30T00:00:00Z'),
}

const setup = (opts: {
    update?: jest.Mock
    memberOf?: string[]
    owns?: string[]
} = {}) => {
    // Echo what the handler wrote, so the response is asserted against
    // behaviour rather than a fixed fixture.
    const update =
        opts.update ??
        jest
            .fn()
            .mockImplementation(async ({ data }) => ({ ...BASE_ROW, ...data }))
    const prisma = {
        user: { update },
        workspaceMember: {
            findMany: jest
                .fn()
                .mockResolvedValue(
                    (opts.memberOf ?? ['w1']).map((workspaceId) => ({ workspaceId })),
                ),
        },
        workspace: {
            findMany: jest
                .fn()
                .mockResolvedValue((opts.owns ?? []).map((id) => ({ id }))),
        },
    }
    const audit = { record: jest.fn() }
    const realtime = { invalidate: jest.fn() }
    const handler = new UpdateMeHandler(
        prisma as never,
        audit as never,
        realtime as never,
    )
    const run = (body: unknown) =>
        handler.execute(new UpdateMeFeature(UpdateMeInputSchema.parse(body), 'u1'))
    return { run, update, audit, realtime }
}

describe('updateMe', () => {
    it('writes only the caller, only the fields sent, trimmed', async () => {
        const { run, update } = setup()
        await run({ firstname: '  Яна  ' })
        expect(update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'u1' },
                data: { firstname: 'Яна' },
            }),
        )
    })

    it('clears a name sent as blank or as null', async () => {
        const { run, update } = setup()
        await run({ firstname: '   ', lastname: null })
        expect(update.mock.calls[0][0].data).toEqual({
            firstname: null,
            lastname: null,
        })
    })

    it('answers with the same shape as GET /me, reflecting the write', async () => {
        const { run } = setup()
        const out = await run({ firstname: 'Яна', lastname: 'Петрова' })
        expect(out).toEqual({
            id: 'u1',
            email: 'yolo@mail.ru',
            firstname: 'Яна',
            lastname: 'Петрова',
            profilePhotoUrl: null,
            language: 'RU',
            isSuperAdmin: false,
            createdAt: '2026-06-30T00:00:00.000Z',
        })
    })

    it('audits and live-refreshes every club the user is in, owned ones included', async () => {
        const { run, audit, realtime } = setup({ memberOf: ['w1', 'w2'], owns: ['w3', 'w1'] })
        await run({ firstname: 'Яна' })
        const audited = audit.record.mock.calls.map((c) => c[0].workspaceId).sort()
        expect(audited).toEqual(['w1', 'w2', 'w3'])
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'member.updateOwnProfile',
                actorId: 'u1',
                targetId: 'u1',
                metadata: { changes: { firstname: 'Яна' } },
            }),
        )
        expect(realtime.invalidate).toHaveBeenCalledWith('w2', ['members', 'leaderboard'])
        expect(realtime.invalidate).toHaveBeenCalledTimes(3)
    })

    it('treats an empty payload as a no-op: no audit, no refresh', async () => {
        const { run, update, audit, realtime } = setup()
        const out = await run({})
        expect(update.mock.calls[0][0].data).toEqual({})
        expect(audit.record).not.toHaveBeenCalled()
        expect(realtime.invalidate).not.toHaveBeenCalled()
        expect(out.id).toBe('u1')
    })

    it('rejects a name over 100 characters', () => {
        expect(() => UpdateMeInputSchema.parse({ firstname: 'я'.repeat(101) })).toThrow()
    })

    it('maps a vanished user to NotFound', async () => {
        const update = jest
            .fn()
            .mockRejectedValue(Object.assign(new Error('gone'), { code: 'P2025' }))
        const { run, audit } = setup({ update })
        await expect(run({ firstname: 'Яна' })).rejects.toThrow('Пользователь не найден')
        expect(audit.record).not.toHaveBeenCalled()
    })
})
