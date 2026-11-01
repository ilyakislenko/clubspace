import {
    DEFAULT_PLATFORM_TIERS,
    resolvePlatformModules,
    resolvePlatformPricing,
    resolvePlatformTiers,
    tierFor,
} from './platform-pricing.config'

describe('resolvePlatformTiers (PLATFORM_PLANS)', () => {
    it('unset or blank = the contract tiers', () => {
        expect(resolvePlatformTiers(undefined)).toEqual(DEFAULT_PLATFORM_TIERS)
        expect(resolvePlatformTiers('  ')).toEqual(DEFAULT_PLATFORM_TIERS)
    })

    it('overrides only the named fields of a known tier', () => {
        const tiers = resolvePlatformTiers('[{"code":"club","priceMonthly":6490}]')
        expect(tiers.find((t) => t.code === 'club')).toEqual({
            code: 'club',
            name: 'Клуб',
            upTo: 100,
            priceMonthly: 6_490,
            extraMemberPrice: 0,
        })
        expect(tiers).not.toBe(DEFAULT_PLATFORM_TIERS)
        expect(DEFAULT_PLATFORM_TIERS[1].priceMonthly).toBe(5_990)
    })

    it('adds a tier and keeps them sorted by upTo', () => {
        const tiers = resolvePlatformTiers(
            '[{"code":"mini","name":"Мини","upTo":20,"priceMonthly":1490}]',
        )
        expect(tiers.map((t) => t.code)).toEqual([
            'mini',
            'start',
            'club',
            'pro',
            'business',
            'network',
        ])
    })

    it.each([
        ['not json', 'must be a JSON array'],
        ['{}', 'must be a JSON array'],
        ['[1]', 'entries must be objects'],
        ['[{"code":"Bad Code"}]', 'needs a "code"'],
        ['[{"code":"club","priceMonthly":-1}]', 'non-negative integer'],
        ['[{"code":"club","upTo":0}]', 'at least 1'],
        ['[{"code":"x","name":"X"}]', 'needs "name", "upTo" and "priceMonthly"'],
        ['[{"code":"business","upTo":null}]', 'exactly one tier'],
        ['[{"code":"pro","upTo":100}]', 'share "upTo"'],
    ])('refuses %s', (raw, message) => {
        expect(() => resolvePlatformTiers(raw)).toThrow(message)
    })
})

describe('resolvePlatformModules (PLATFORM_MODULES)', () => {
    it('overrides a module price and allowance', () => {
        const video = resolvePlatformModules(
            '[{"code":"VIDEO","priceMonthly":1290,"includedStorageGb":50}]',
        ).find((m) => m.code === 'VIDEO')
        expect(video).toMatchObject({
            priceMonthly: 1_290,
            includedStorageGb: 50,
            includedViewHours: 100,
        })
    })

    it('refuses an unknown module', () => {
        expect(() => resolvePlatformModules('[{"code":"CHAT"}]')).toThrow(
            'must be one of VIDEO, ONLINE_PAYMENTS, BRANDED_APP',
        )
    })
})

describe('resolvePlatformPricing', () => {
    it('validates the annual discount and the setup fee', () => {
        expect(() =>
            resolvePlatformPricing({ annualDiscountPercent: 101, setupFee: 0 }),
        ).toThrow('PLATFORM_ANNUAL_DISCOUNT_PERCENT')
        expect(
            resolvePlatformPricing({ annualDiscountPercent: 15, setupFee: 4_990 }),
        ).toMatchObject({ currency: 'RUB', annualDiscountPercent: 15, setupFee: 4_990 })
    })
})

describe('tierFor', () => {
    it('reports the floor and the members above it on the top tier', () => {
        expect(tierFor(DEFAULT_PLATFORM_TIERS, 401)).toMatchObject({
            floor: 400,
            extraMembers: 1,
            monthly: 17_025,
        })
        expect(tierFor(DEFAULT_PLATFORM_TIERS, 51)).toMatchObject({
            floor: 50,
            extraMembers: 0,
            monthly: 5_990,
        })
    })
})
