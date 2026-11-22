import {
    discountApplies,
    type DiscountRule,
    discountStatus,
    normalizePromoCode,
    priceSale,
    saleDiscount,
} from './discount-rules'

const rule = (over: Partial<DiscountRule> = {}): DiscountRule => ({
    id: 'd1',
    name: 'Весна',
    kind: 'PERCENT',
    value: 10,
    currency: null,
    code: null,
    isFamily: false,
    allPlans: true,
    planIds: [],
    events: false,
    startsOn: null,
    endsOn: null,
    maxUses: null,
    oncePerMember: false,
    isActive: true,
    ...over,
})

const plan = (listPrice = 4500, currency = 'RUB') => ({
    planId: 'p1',
    eventId: null,
    listPrice,
    currency,
})
const ticket = (listPrice = 1500) => ({ planId: null, eventId: 'e1', listPrice, currency: 'RUB' })

describe('normalizePromoCode', () => {
    it('trims, upper-cases and turns Ё into Е', () => {
        expect(normalizePromoCode('  весна ')).toBe('ВЕСНА')
        expect(normalizePromoCode('ёлка-2027')).toBe('ЕЛКА-2027')
        expect(normalizePromoCode('Spring5')).toBe('SPRING5')
    })

    it('refuses junk, too short and too long codes', () => {
        expect(normalizePromoCode('ab')).toBeNull()
        expect(normalizePromoCode('ВЕС НА')).toBeNull()
        expect(normalizePromoCode('promo!')).toBeNull()
        expect(normalizePromoCode('A'.repeat(33))).toBeNull()
        expect(normalizePromoCode('A'.repeat(32))).toBe('A'.repeat(32))
    })
})

describe('priceSale', () => {
    it('rounds a percent half up', () => {
        expect(priceSale({ listPrice: 4500, currency: 'RUB', discount: rule({ value: 5 }) })).toEqual({
            amount: 4275,
            discountAmount: 225,
            discountId: 'd1',
            discountName: 'Весна',
        })
        expect(priceSale({ listPrice: 3333, currency: 'RUB', discount: rule() }).discountAmount).toBe(333)
        // 35 × 10% = 3.5 → 4
        expect(priceSale({ listPrice: 35, currency: 'RUB', discount: rule() }).discountAmount).toBe(4)
    })

    it('caps a fixed sum at the price', () => {
        const fixed = rule({ kind: 'FIXED', value: 500, currency: 'RUB' })
        expect(priceSale({ listPrice: 4000, currency: 'RUB', discount: fixed }).amount).toBe(3500)
        expect(priceSale({ listPrice: 300, currency: 'RUB', discount: fixed })).toMatchObject({
            amount: 0,
            discountAmount: 300,
        })
    })

    it('never touches a 0 price, and no discount is the list price', () => {
        expect(priceSale({ listPrice: 0, currency: 'RUB', discount: rule() })).toEqual({
            amount: 0,
            discountAmount: 0,
            discountId: null,
            discountName: null,
        })
        expect(priceSale({ listPrice: 4000, currency: 'RUB', discount: null }).amount).toBe(4000)
    })
})

describe('discountApplies', () => {
    it('applies an active all-tariffs discount', () => {
        expect(discountApplies(rule(), plan(), '2027-03-01')).toBeNull()
    })

    it('refuses an archived one first', () => {
        expect(discountApplies(rule({ isActive: false, endsOn: new Date('2020-01-01') }), plan(), '2027-03-01'))
            .toMatchObject({ reason: 'archived' })
    })

    it('checks club-local days inclusively at both edges', () => {
        const dated = rule({ startsOn: new Date('2027-03-01T00:00:00Z'), endsOn: new Date('2027-03-31T00:00:00Z') })
        expect(discountApplies(dated, plan(), '2027-03-01')).toBeNull()
        expect(discountApplies(dated, plan(), '2027-03-31')).toBeNull()
        expect(discountApplies(dated, plan(), '2027-02-28')).toEqual({
            reason: 'scheduled',
            message: 'Срок скидки «Весна» ещё не начался',
        })
        expect(discountApplies(dated, plan(), '2027-04-01')).toEqual({
            reason: 'expired',
            message: 'Срок скидки «Весна» закончился',
        })
    })

    it('checks the scope: chosen tariffs, events', () => {
        const chosen = rule({ allPlans: false, planIds: ['p2'] })
        expect(discountApplies(chosen, plan(), '2027-03-01')).toEqual({
            reason: 'scope',
            message: 'Скидка «Весна» не действует на этот тариф',
        })
        expect(discountApplies(chosen, { ...plan(), planId: 'p2' }, '2027-03-01')).toBeNull()
        expect(discountApplies(rule(), ticket(), '2027-03-01')).toEqual({
            reason: 'scope',
            message: 'Скидка «Весна» не действует на это событие',
        })
        expect(discountApplies(rule({ events: true }), ticket(), '2027-03-01')).toBeNull()
    })

    it('a fixed sum applies only in its currency', () => {
        const fixed = rule({ kind: 'FIXED', value: 500, currency: 'RUB' })
        expect(discountApplies(fixed, plan(4500, 'KZT'), '2027-03-01')).toMatchObject({ reason: 'currency' })
        expect(discountApplies(fixed, plan(4500, 'RUB'), '2027-03-01')).toBeNull()
        // A percent works in any currency.
        expect(discountApplies(rule(), plan(4500, 'KZT'), '2027-03-01')).toBeNull()
    })

    it('never applies to a free item', () => {
        expect(discountApplies(rule(), plan(0), '2027-03-01')).toEqual({
            reason: 'free',
            message: 'Скидка «Весна» не действует на бесплатный тариф',
        })
    })
})

describe('saleDiscount', () => {
    it('splits the total into the named part and the one-off rest', () => {
        expect(saleDiscount({ listPrice: 5000, amountPaid: 3600, discountAmount: 500 })).toEqual({
            total: 1400,
            named: 500,
            oneOff: 900,
        })
        expect(saleDiscount({ listPrice: 5000, amountPaid: 4000, discountAmount: 0 })).toEqual({
            total: 1000,
            named: 0,
            oneOff: 1000,
        })
    })

    it('shows nothing when the amount is above the price or the price is unknown', () => {
        expect(saleDiscount({ listPrice: 5000, amountPaid: 5200, discountAmount: 500 })).toEqual({
            total: 0,
            named: 0,
            oneOff: 0,
        })
        expect(saleDiscount({ listPrice: 5000, amountPaid: 4800, discountAmount: 500 })).toEqual({
            total: 200,
            named: 200,
            oneOff: 0,
        })
        expect(saleDiscount({ listPrice: null, amountPaid: 1000, discountAmount: 0 })).toEqual({
            total: 0,
            named: 0,
            oneOff: 0,
        })
    })
})

describe('discountStatus', () => {
    it('archived, expired, scheduled, exhausted, active — in that order', () => {
        const today = '2027-03-10'
        expect(discountStatus(rule({ isActive: false }), 0, today)).toBe('archived')
        expect(discountStatus(rule({ endsOn: new Date('2027-03-09') }), 0, today)).toBe('expired')
        expect(discountStatus(rule({ startsOn: new Date('2027-03-11') }), 0, today)).toBe('scheduled')
        expect(discountStatus(rule({ maxUses: 2 }), 2, today)).toBe('exhausted')
        expect(discountStatus(rule({ maxUses: 2 }), 1, today)).toBe('active')
    })
})
