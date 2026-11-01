import { BYTES_PER_GB } from './billing-rules'
import {
    DEFAULT_PLATFORM_MODULES,
    DEFAULT_PLATFORM_TIERS,
    type PlatformPricing,
} from './platform-pricing.config'
import {
    type QuoteInputs,
    type QuoteModuleInput,
    quoteWorkspaceBilling,
    type WorkspaceQuote,
} from './quote-workspace-billing'

// The contract numbers (shared with the pitch deck): Старт ≤50 2 990, Клуб
// ≤100 5 990, Про ≤200 9 990, Бизнес ≤400 16 990, Сеть 16 990 + 35/member
// over 400; VIDEO 990 (20 ГБ + 100 ч, then 10 ₽/ГБ, 5 ₽/ч), ONLINE_PAYMENTS
// 490, BRANDED_APP 2 990; annual −15 %; setup 4 990 once.
const pricing: PlatformPricing = {
    currency: 'RUB',
    tiers: DEFAULT_PLATFORM_TIERS,
    modules: DEFAULT_PLATFORM_MODULES,
    annualDiscountPercent: 15,
    setupFee: 4_990,
}

const START = new Date('2026-12-01T00:00:00.000Z')

const quote = (over: Partial<QuoteInputs> = {}) =>
    quoteWorkspaceBilling({
        pricing,
        activeMembers: 10,
        periodStart: START,
        periodMonths: 1,
        subscription: { customMonthlyPrice: null, discountPercent: 0, freeUntil: null },
        // Most cases look at the recurring part: setup already paid.
        setupFee: { waived: false, paid: true },
        modules: [],
        usage: { storageBytes: 0, viewedSeconds: 0 },
        ...over,
    })

const mod = (code: QuoteModuleInput['code'], over: Partial<QuoteModuleInput> = {}) => ({
    code,
    mode: 'PAID' as const,
    compUntil: null,
    customPrice: null,
    ...over,
})

const amount = (q: WorkspaceQuote, code: string) =>
    q.lines.find((l) => l.code === code)?.amount

describe('quoteWorkspaceBilling — tiers', () => {
    it.each([
        [0, 'start', 2_990],
        [1, 'start', 2_990],
        [50, 'start', 2_990],
        [51, 'club', 5_990],
        [100, 'club', 5_990],
        [101, 'pro', 9_990],
        [200, 'pro', 9_990],
        [201, 'business', 16_990],
        [400, 'business', 16_990],
        [401, 'network', 17_025],
        [450, 'network', 18_740],
        [1_000, 'network', 37_990],
    ])('%i active members → %s, %i ₽', (active, tierCode, price) => {
        const q = quote({ activeMembers: active })
        expect(q.tierCode).toBe(tierCode)
        expect(q.lines).toEqual([
            expect.objectContaining({ code: 'tier', amount: price }),
        ])
        expect(q).toMatchObject({ subtotal: price, discount: 0, total: price })
    })

    it('spells the network formula out on the line', () => {
        expect(
            quote({ activeMembers: 412 }).lines[0].title.replace(/\s/g, ' '),
        ).toBe(
            'Тариф «Сеть» — 412 активных (16 990 ₽ + 35 ₽ × 12 сверх 400)',
        )
    })

    it('a custom monthly price replaces the tier price', () => {
        const q = quote({
            activeMembers: 300,
            subscription: { customMonthlyPrice: 9_000, discountPercent: 0, freeUntil: null },
        })
        expect(q.lines).toEqual([
            expect.objectContaining({ code: 'subscription', amount: 9_000 }),
        ])
        expect(q.tierCode).toBe('business')
        expect(q.total).toBe(9_000)
    })
})

describe('quoteWorkspaceBilling — modules', () => {
    it('adds paid modules at their price, in canonical order', () => {
        const q = quote({
            modules: [mod('BRANDED_APP'), mod('VIDEO'), mod('ONLINE_PAYMENTS')],
        })
        expect(q.lines.map((l) => [l.code, l.amount])).toEqual([
            ['tier', 2_990],
            ['module:VIDEO', 990],
            ['module:ONLINE_PAYMENTS', 490],
            ['module:BRANDED_APP', 2_990],
        ])
        expect(q.total).toBe(2_990 + 990 + 490 + 2_990)
    })

    it('uses the platform custom module price', () => {
        expect(amount(quote({ modules: [mod('VIDEO', { customPrice: 500 })] }), 'module:VIDEO')).toBe(500)
    })

    it('keeps OFF / default modules off the bill', () => {
        const q = quote({
            modules: [mod('VIDEO', { mode: 'OFF' }), mod('ONLINE_PAYMENTS', { mode: null })],
        })
        expect(q.lines.map((l) => l.code)).toEqual(['tier'])
    })

    it('a module the club disconnected leaves the bill from its cancel date', () => {
        const later = new Date(START.getTime() + 86_400_000)
        expect(
            quote({ modules: [mod('VIDEO', { cancelAt: START })] }).lines.map((l) => l.code),
        ).toEqual(['tier'])
        expect(amount(quote({ modules: [mod('VIDEO', { cancelAt: later })] }), 'module:VIDEO')).toBe(990)
    })

    it('a running comp shows at 0; an expired comp is off the bill', () => {
        const running = quote({
            modules: [mod('VIDEO', { mode: 'COMP', compUntil: new Date('2027-03-01T00:00:00Z') })],
        })
        expect(running.lines[1]).toEqual({
            code: 'module:VIDEO',
            title: 'Модуль «Видео» — бесплатно до 01.03.2027',
            amount: 0,
        })
        const expired = quote({
            modules: [mod('VIDEO', { mode: 'COMP', compUntil: new Date('2026-11-30T00:00:00Z') })],
        })
        expect(expired.lines.map((l) => l.code)).toEqual(['tier'])
    })
})

describe('quoteWorkspaceBilling — VIDEO overage', () => {
    const video = (storageGb: number, hours: number, over: Partial<QuoteModuleInput> = {}) =>
        quote({
            modules: [mod('VIDEO', over)],
            usage: {
                storageBytes: Math.round(storageGb * BYTES_PER_GB),
                viewedSeconds: Math.round(hours * 3600),
            },
        })

    it('nothing within 20 GB and 100 hours', () => {
        expect(video(20, 100).lines.map((l) => l.code)).toEqual(['tier', 'module:VIDEO'])
    })

    it('counts every started extra GB and hour', () => {
        const q = video(25.2, 130.5)
        expect(amount(q, 'overage:storage')).toBe(6 * 10)
        expect(amount(q, 'overage:viewing')).toBe(31 * 5)
        expect(q.lines.find((l) => l.code === 'overage:storage')?.title).toBe(
            'Хранилище сверх 20 ГБ: 6 ГБ × 10 ₽',
        )
        expect(q.total).toBe(2_990 + 990 + 60 + 155)
    })

    it('bills overage on a comped VIDEO too, never without VIDEO', () => {
        expect(
            amount(video(30, 0, { mode: 'COMP', compUntil: new Date('2027-06-01Z') }), 'overage:storage'),
        ).toBe(100)
        const off = quote({
            modules: [mod('VIDEO', { mode: 'OFF' })],
            usage: { storageBytes: 30 * BYTES_PER_GB, viewedSeconds: 500 * 3600 },
        })
        expect(off.lines.map((l) => l.code)).toEqual(['tier'])
    })
})

describe('quoteWorkspaceBilling — setup fee', () => {
    it('charges 4 990 once, not discounted', () => {
        const q = quote({
            setupFee: { waived: false, paid: false },
            periodMonths: 12,
            subscription: { customMonthlyPrice: null, discountPercent: 50, freeUntil: null },
        })
        expect(amount(q, 'setup')).toBe(4_990)
        // 2 990 × 12 = 35 880; annual 15 % = 5 382; then 50 % of 30 498 = 15 249.
        expect(q.discount).toBe(5_382 + 15_249)
        expect(q.total).toBe(35_880 + 4_990 - 5_382 - 15_249)
    })

    it('is skipped when waived or already paid', () => {
        expect(amount(quote({ setupFee: { waived: true, paid: false } }), 'setup')).toBeUndefined()
        expect(amount(quote({ setupFee: { waived: false, paid: true } }), 'setup')).toBeUndefined()
    })
})

describe('quoteWorkspaceBilling — annual and discounts', () => {
    it('annual prepay: 12 months of tier + modules, −15 %', () => {
        const q = quote({
            activeMembers: 80,
            periodMonths: 12,
            modules: [mod('VIDEO')],
        })
        expect(q.periodMonths).toBe(12)
        expect(amount(q, 'tier')).toBe(5_990 * 12)
        expect(amount(q, 'module:VIDEO')).toBe(990 * 12)
        const recurring = (5_990 + 990) * 12
        expect(q.discounts).toEqual([
            { code: 'annual', title: 'Оплата за год −15%', amount: Math.round(recurring * 0.15) },
        ])
        expect(q.total).toBe(recurring - Math.round(recurring * 0.15))
        expect(q.total).toBe(71_196)
    })

    it('platform discount % comes off the recurring part only (not overage)', () => {
        const q = quote({
            modules: [mod('VIDEO')],
            usage: { storageBytes: 21 * BYTES_PER_GB, viewedSeconds: 0 },
            subscription: { customMonthlyPrice: null, discountPercent: 10, freeUntil: null },
        })
        expect(q.discounts).toEqual([
            { code: 'platform', title: 'Скидка 10%', amount: Math.round((2_990 + 990) * 0.1) },
        ])
        expect(q.total).toBe(2_990 + 990 + 10 - 398)
    })

    it('100 % discount makes the subscription free', () => {
        const q = quote({
            subscription: { customMonthlyPrice: null, discountPercent: 100, freeUntil: null },
        })
        expect(q.total).toBe(0)
    })

    it('a discount with an end date covers only the part of the period before it', () => {
        const until = (d: string) =>
            quote({
                subscription: {
                    customMonthlyPrice: null,
                    discountPercent: 20,
                    discountUntil: new Date(d),
                    freeUntil: null,
                },
            })
        // Ends after the period: the whole −20 %, dated.
        const whole = until('2027-01-15T00:00:00Z')
        expect(whole.discounts).toEqual([
            { code: 'platform', title: 'Скидка 20% до 15.01.2027', amount: 598 },
        ])
        expect(whole.total).toBe(2_392)
        // Ends exactly where the period starts: gone.
        const over = until('2026-12-01T00:00:00Z')
        expect(over.discounts).toEqual([])
        expect(over.total).toBe(2_990)
        // Ends mid-period (16 of December's 31 days): pro rata.
        const half = until('2026-12-17T00:00:00Z')
        expect(half.discount).toBe(Math.round((2_990 * 20 * 16) / 31 / 100))
    })
})

describe('quoteWorkspaceBilling — free period (promo)', () => {
    const free = (freeUntil: Date, periodMonths = 1) =>
        quote({
            activeMembers: 60,
            periodMonths,
            modules: [mod('ONLINE_PAYMENTS')],
            subscription: { customMonthlyPrice: null, discountPercent: 0, freeUntil },
        })

    it('a free period covering the whole charge zeroes the recurring lines', () => {
        const q = free(new Date('2027-01-31T20:59:59.999Z'))
        expect(q.lines.map((l) => l.amount)).toEqual([0, 0])
        expect(q.lines[0].title).toBe('Тариф «Клуб» — до 100 активных — бесплатно до 31.01.2027')
        expect(q.total).toBe(0)
    })

    it('a free period that already ended changes nothing', () => {
        expect(free(new Date('2026-11-15T00:00:00Z')).total).toBe(5_990 + 490)
    })

    it('a free period ending inside the period is charged pro rata', () => {
        // December has 31 days; free through 16 Dec 00:00 UTC → 16/31 to pay.
        const q = free(new Date('2026-12-16T00:00:00Z'))
        expect(amount(q, 'tier')).toBe(Math.round((5_990 * 16) / 31))
        expect(amount(q, 'module:ONLINE_PAYMENTS')).toBe(Math.round((490 * 16) / 31))
    })

    it('still charges the setup fee and overage', () => {
        const q = quote({
            setupFee: { waived: false, paid: false },
            modules: [mod('VIDEO')],
            usage: { storageBytes: 22 * BYTES_PER_GB, viewedSeconds: 0 },
            subscription: {
                customMonthlyPrice: null,
                discountPercent: 0,
                freeUntil: new Date('2027-06-01T00:00:00Z'),
            },
        })
        expect(q.total).toBe(4_990 + 20)
    })
})
