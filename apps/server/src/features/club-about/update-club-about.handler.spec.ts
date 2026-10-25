import {
    BadRequestError,
    ForbiddenError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { UpdateClubAboutFeature } from './update-club-about.feature'
import { UpdateClubAboutHandler } from './update-club-about.handler'

const build = () => {
    const update = jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
            aboutContacts: data.aboutContacts,
            aboutLinks: data.aboutLinks,
            aboutRules: data.aboutRules,
            aboutUpdatedAt: data.aboutUpdatedAt,
        }),
    )
    const record = jest.fn().mockResolvedValue(undefined)
    const invalidate = jest.fn()
    const prisma = {
        workspace: {
            update,
            findUnique: jest.fn().mockResolvedValue({
                ownerId: 'owner',
                coachSeesAllGroups: false,
            }),
        },
    }
    const handler = new UpdateClubAboutHandler(
        prisma as never,
        new RbacService(prisma as never),
        { record } as never,
        { invalidate } as never,
    )
    return { handler, update, record, invalidate }
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

    it('lets the owner (no member row) save', async () => {
        const { handler, update } = build()
        await run(handler, payload, { userId: 'owner', roleName: null })
        expect(update).toHaveBeenCalledTimes(1)
    })

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
})
