import { UpdateClubAboutFeatureInputSchema } from './update-club-about.feature'

const base = {
    contacts: [{ label: 'Главный тренер', phone: '+7 952 884-94-20' }],
    links: [{ label: 'Сайт', url: 'https://club.example' }],
    rules: 'Правило 1',
}

const withUrl = (url: string) => ({
    ...base,
    links: [{ label: 'Сайт', url }],
})

describe('UpdateClubAboutFeatureInputSchema', () => {
    it('accepts a valid payload', () => {
        expect(UpdateClubAboutFeatureInputSchema.safeParse(base).success).toBe(
            true,
        )
    })

    it.each([
        ['data:text/html,<b>x</b>'],
        ['javascript:alert(1)'],
        ['JavaScript:alert(1)'],
        ['JAVASCRIPT:alert(1)'],
        ['java\tscript:alert(1)'],
        ['\tjavascript:alert(1)'],
        ['club.example'],
        ['ftp://club.example'],
    ])('rejects the link %p', (url) => {
        expect(
            UpdateClubAboutFeatureInputSchema.safeParse(withUrl(url)).success,
        ).toBe(false)
    })

    it('stores the trimmed link as typed (no punycode / percent-encoding)', () => {
        const res = UpdateClubAboutFeatureInputSchema.parse(
            withUrl('  https://клуб.рф/о-нас  '),
        )
        expect(res.links[0].url).toBe('https://клуб.рф/о-нас')
    })

    it('rejects control characters inside a link', () => {
        expect(
            UpdateClubAboutFeatureInputSchema.safeParse(
                withUrl('https://club.example/\u0001x'),
            ).success,
        ).toBe(false)
    })

    it('rejects 11 contacts', () => {
        const contacts = Array.from({ length: 11 }, (_, i) => ({
            label: `K${i}`,
            phone: '+79528849420',
        }))
        expect(
            UpdateClubAboutFeatureInputSchema.safeParse({ ...base, contacts })
                .success,
        ).toBe(false)
    })

    it('rejects rules over 10000 characters', () => {
        expect(
            UpdateClubAboutFeatureInputSchema.safeParse({
                ...base,
                rules: 'a'.repeat(10001),
            }).success,
        ).toBe(false)
        expect(
            UpdateClubAboutFeatureInputSchema.safeParse({
                ...base,
                rules: 'a'.repeat(10000),
            }).success,
        ).toBe(true)
    })
})
