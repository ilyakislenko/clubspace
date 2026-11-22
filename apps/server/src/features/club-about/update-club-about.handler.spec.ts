import {
    BadRequestError,
    ForbiddenError,
    StaleUpdateError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { UpdateClubAboutFeature } from './update-club-about.feature'
import { UpdateClubAboutHandler } from './update-club-about.handler'

// «О клубе»'s current version in the mocked database.
const ABOUT_AT = new Date('2026-11-14T10:00:00.000Z')

const build = () => {
    const update = jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
            aboutContacts: data.aboutContacts,
            aboutLinks: data.aboutLinks,
            aboutRules: data.aboutRules,
            aboutUpdatedAt: data.aboutUpdatedAt,
            updatedAt: new Date('2026-11-14T11:00:00.000Z'),
        }),
    )
    const record = jest.fn().mockResolvedValue(undefined)
    // The compare-and-set: matches only the stored version.
    const updateMany = jest.fn(
        async (args: { where: { aboutUpdatedAt: Date } }) => ({
            count: args.where.aboutUpdatedAt.getTime() === ABOUT_AT.getTime() ? 1 : 0,
        }),
    )
    const invalidate = jest.fn()
    const prisma = {
        workspace: {
            update,
            updateMany,
            findUnique: jest.fn().mockResolvedValue({
                ownerId: 'owner',
                coachSeesAllGroups: false,
            }),
        },
        $transaction(fn: (tx: unknown) => unknown) {
            return fn(this)
        },
    }
    const handler = new UpdateClubAboutHandler(
        prisma as never,
        new RbacService(prisma as never),
        { record } as never,
        { invalidate } as never,
    )
    return { handler, update, updateMany, record, invalidate }
}

const payload = {
    contacts: [{ label: 'Главный тренер', phone: '8-952-884-94-20' }],
    links: [{ label: 'Сайт', url: 'https://club.example' }],
    rules: 'Правило 1',
}

const run = (
    handler: UpdateClubAboutHandler,
    body: ConstructorParameters<typeof UpdateClubAboutFeature>[0],
    who: { userId: string; roleName: string | null } = {
        userId: 'admin1',
        roleName: 'admin',
    },
) =>
    handler.execute(
        new UpdateClubAboutFeature(body, 'w1', who.userId, who.roleName, false),
    )

describe('updateClubAbout', () => {
    it.each(['coach', 'user'])(
        'refuses a %s and writes nothing',
        async (roleName) => {
            const { handler, update, record, invalidate } = build()
            await expect(
                run(handler, payload, { userId: 'u1', roleName }),
            ).rejects.toBeInstanceOf(ForbiddenError)
            expect(update).not.toHaveBeenCalled()
            expect(record).not.toHaveBeenCalled()
            expect(invalidate).not.toHaveBeenCalled()
        },
    )

    it('refuses a head coach — a sport lead, not a club admin — and writes nothing', async () => {
        const { handler, update } = build()
        await expect(
            run(handler, payload, { userId: 'hc1', roleName: 'head_coach' }),
        ).rejects.toThrow(
            new ForbiddenError({
                message: 'Менять информацию о клубе может только администратор клуба',
            }),
        )
        expect(update).not.toHaveBeenCalled()
    })

    it('lets a platform super admin save', async () => {
        const { handler, update } = build()
        await handler.execute(
            new UpdateClubAboutFeature(payload, 'w1', 'sa1', null, true),
        )
        expect(update).toHaveBeenCalledTimes(1)
    })

    it.each([null, 'head_coach'])(
        'lets the owner save, whatever their member row says (%s)',
        async (roleName) => {
            const { handler, update } = build()
            await run(handler, payload, { userId: 'owner', roleName })
            expect(update).toHaveBeenCalledTimes(1)
        },
    )

    it('normalizes phones, stamps aboutUpdatedAt, audits and invalidates', async () => {
        const { handler, update, record, invalidate } = build()
        const res = await run(handler, payload)
        const data = update.mock.calls[0][0].data
        expect(data.aboutContacts).toEqual([
            { label: 'Главный тренер', phone: '+79528849420' },
        ])
        expect(data.aboutLinks).toEqual(payload.links)
        expect(data.aboutRules).toBe('Правило 1')
        expect(data.aboutUpdatedAt).toBeInstanceOf(Date)
        expect(res.contacts[0].phone).toBe('+79528849420')
        expect(res.updatedAt).toBe(data.aboutUpdatedAt.toISOString())
        expect(record.mock.calls[0][0]).toMatchObject({
            action: 'workspace.updateAbout',
            workspaceId: 'w1',
            actorId: 'admin1',
        })
        expect(invalidate).toHaveBeenCalledWith('w1', ['about'])
    })

    it('stores empty rules as null', async () => {
        const { handler, update } = build()
        await run(handler, { ...payload, rules: '' })
        expect(update.mock.calls[0][0].data.aboutRules).toBeNull()
    })

    it('rejects a phone that is not a number and writes nothing', async () => {
        const { handler, update } = build()
        await expect(
            run(handler, {
                ...payload,
                contacts: [{ label: 'X', phone: '12345' }],
            }),
        ).rejects.toThrow(BadRequestError)
        expect(update).not.toHaveBeenCalled()
    })

    it('refuses a form that read an older «О клубе» with 409, writing nothing', async () => {
        const { handler, update, record, invalidate } = build()
        const err = await run(handler, {
            ...payload,
            expectedUpdatedAt: '2026-11-14T09:00:00.000Z',
        }).catch((e: unknown) => e)
        expect(err).toBeInstanceOf(StaleUpdateError)
        expect((err as StaleUpdateError).statusCode).toBe(409)
        expect(update).not.toHaveBeenCalled()
        expect(record).not.toHaveBeenCalled()
        expect(invalidate).not.toHaveBeenCalled()
    })

    it('saves a form that read the current «О клубе» and reports the club row version', async () => {
        const { handler, update, updateMany } = build()
        const out = await run(handler, {
            ...payload,
            expectedUpdatedAt: ABOUT_AT.toISOString(),
        })
        expect(updateMany.mock.calls[0][0].where).toEqual({
            id: 'w1',
            aboutUpdatedAt: ABOUT_AT,
        })
        expect(update).toHaveBeenCalledTimes(1)
        expect(out.clubUpdatedAt).toBe('2026-11-14T11:00:00.000Z')
    })

    it('keeps last-write-wins when the version is omitted', async () => {
        const { handler, update, updateMany } = build()
        await run(handler, payload)
        expect(updateMany).not.toHaveBeenCalled()
        expect(update).toHaveBeenCalledTimes(1)
    })
})
