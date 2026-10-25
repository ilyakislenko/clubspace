import { NotFoundError } from '../../shared/errors/shared.errors'
import { GetClubAboutFeature } from './get-club-about.feature'
import { GetClubAboutHandler } from './get-club-about.handler'

const build = (row: unknown) => {
    const findUnique = jest.fn().mockResolvedValue(row)
    const handler = new GetClubAboutHandler({
        workspace: { findUnique },
    } as never)
    return { handler, findUnique }
}

describe('getClubAbout', () => {
    it('serializes the stored columns', async () => {
        const { handler, findUnique } = build({
            aboutContacts: [{ label: 'Главный тренер', phone: '+79528849420' }],
            aboutLinks: [{ label: 'Сайт', url: 'https://club.example' }],
            aboutRules: 'Правило 1',
            aboutUpdatedAt: new Date('2026-10-01T10:00:00.000Z'),
        })
        const res = await handler.execute(new GetClubAboutFeature('w1'))
        expect(findUnique.mock.calls[0][0].where).toEqual({ id: 'w1' })
        expect(res).toEqual({
            contacts: [{ label: 'Главный тренер', phone: '+79528849420' }],
            links: [{ label: 'Сайт', url: 'https://club.example' }],
            rules: 'Правило 1',
            updatedAt: '2026-10-01T10:00:00.000Z',
        })
    })

    it('returns empty defaults for an unfilled club', async () => {
        const { handler } = build({
            aboutContacts: [],
            aboutLinks: [],
            aboutRules: null,
            aboutUpdatedAt: null,
        })
        expect(await handler.execute(new GetClubAboutFeature('w1'))).toEqual({
            contacts: [],
            links: [],
            rules: null,
            updatedAt: null,
        })
    })

    it('falls back to empty lists on malformed stored JSON instead of failing', async () => {
        const { handler } = build({
            aboutContacts: { not: 'a list' },
            aboutLinks: [{ label: 5 }],
            aboutRules: null,
            aboutUpdatedAt: null,
        })
        const res = await handler.execute(new GetClubAboutFeature('w1'))
        expect(res.contacts).toEqual([])
        expect(res.links).toEqual([])
    })

    it('drops stored links that are not http(s)', async () => {
        const { handler } = build({
            aboutContacts: [],
            aboutLinks: [
                { label: 'Плохая', url: 'javascript:alert(1)' },
                { label: 'Тоже', url: 'JavaScript:alert(1)' },
                { label: 'Сайт', url: 'https://club.example' },
            ],
            aboutRules: null,
            aboutUpdatedAt: null,
        })
        const res = await handler.execute(new GetClubAboutFeature('w1'))
        expect(res.links).toEqual([
            { label: 'Сайт', url: 'https://club.example' },
        ])
    })

    it('throws NotFound for an unknown club', async () => {
        const { handler } = build(null)
        await expect(
            handler.execute(new GetClubAboutFeature('nope')),
        ).rejects.toBeInstanceOf(NotFoundError)
    })
})
