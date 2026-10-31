import { UpdateClubPublicProfileFeatureInputSchema } from './update-club-public-profile.feature'

const base = {
    slug: 'gracie-tomsk',
    city: 'Томск',
    description: 'Зал',
    logoKey: null,
    isListed: false,
}

describe('UpdateClubPublicProfileFeatureInputSchema', () => {
    it('normalises the slug to its stored form', () => {
        expect(
            UpdateClubPublicProfileFeatureInputSchema.parse({
                ...base,
                slug: '  Gracie-Tomsk ',
            }).slug,
        ).toBe('gracie-tomsk')
    })

    it.each(['ab', 'грэпплинг', 'gracie_tomsk', 'gracie--tomsk'])(
        'rejects the slug %s',
        (slug) => {
            expect(
                UpdateClubPublicProfileFeatureInputSchema.safeParse({
                    ...base,
                    slug,
                }).success,
            ).toBe(false)
        },
    )

    it('stores blank text as null', () => {
        const out = UpdateClubPublicProfileFeatureInputSchema.parse({
            ...base,
            city: '   ',
            description: '',
        })
        expect(out.city).toBeNull()
        expect(out.description).toBeNull()
    })

    it('caps the description', () => {
        expect(
            UpdateClubPublicProfileFeatureInputSchema.safeParse({
                ...base,
                description: 'x'.repeat(2001),
            }).success,
        ).toBe(false)
    })
})
