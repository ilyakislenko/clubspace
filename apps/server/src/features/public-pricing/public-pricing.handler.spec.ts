import {
    DEFAULT_PLATFORM_MODULES,
    DEFAULT_PLATFORM_TIERS,
    type PlatformPricing,
} from '../../domains/billing/platform-pricing.config'
import { environment } from '../../environments/environment'
import { GetPublicPricingHandler } from './get-public-pricing.handler'
import {
    GetPublicPricingOutputSchema,
    QuotePublicPricingFeature,
    QuotePublicPricingInputSchema,
    QuotePublicPricingOutputSchema,
} from './public-pricing.feature'
import { publicPricingView, quotePublicPricing } from './public-pricing-utils'
import { QuotePublicPricingHandler } from './quote-public-pricing.handler'

const PRICING: PlatformPricing = {
    currency: 'RUB',
    tiers: DEFAULT_PLATFORM_TIERS,
    modules: DEFAULT_PLATFORM_MODULES,
    annualDiscountPercent: 15,
    setupFee: 4_990,
}
const NOW = new Date('2026-11-01T09:00:00Z')

const quote = (input: object) =>
    quotePublicPricing(PRICING, QuotePublicPricingInputSchema.parse(input), NOW)

describe('publicPricingView', () => {
    it('lists the configured tiers, modules, trial, setup fee and discount', () => {
        const view = publicPricingView(PRICING, 30)
        expect(view.currency).toBe('RUB')
        expect(view.trialDays).toBe(30)
        expect(view.setupFee).toBe(4_990)
        expect(view.annualDiscountPercent).toBe(15)
        expect(view.tiers.map((t) => [t.name, t.upTo, t.priceMonthly])).toEqual([
            ['Старт', 50, 2_990],
            ['Клуб', 100, 5_990],
            ['Про', 200, 9_990],
            ['Бизнес', 400, 16_990],
            ['Сеть', null, 16_990],
        ])
        expect(view.tiers[4].extraMemberPrice).toBe(35)
        expect(view.modules.map((m) => [m.code, m.priceMonthly])).toEqual([
            ['VIDEO', 990],
            ['ONLINE_PAYMENTS', 490],
            ['BRANDED_APP', 2_990],
        ])
        expect(view.modules[0].includedStorageGb).toBe(20)
        expect(view.modules[0].includedViewHours).toBe(100)
        expect(GetPublicPricingOutputSchema.parse(view)).toEqual(view)
    })

    it('copies the module feature lists instead of handing out the config', () => {
        const view = publicPricingView(PRICING, 30)
        view.modules[0].includes.push('mutated')
        expect(PRICING.modules[0].includes).not.toContain('mutated')
    })
})

describe('quotePublicPricing', () => {
    it('prices a month of the tier with the setup fee on the first payment', () => {
        const out = quote({ activeMembers: 80, modules: [], periodMonths: 1 })
        expect(out.quote.tierCode).toBe('club')
        expect(out.quote.lines.map((l) => [l.code, l.amount])).toEqual([
            ['tier', 5_990],
            ['setup', 4_990],
        ])
        expect(out.quote.total).toBe(10_980)
        expect(out.renewal).toBe(5_990)
        expect(out.perMonth).toBe(5_990)
        expect(QuotePublicPricingOutputSchema.parse(out)).toEqual(out)
    })

    it('adds modules once each and takes the annual discount off recurring lines only', () => {
        const out = quote({
            activeMembers: 450,
            modules: ['VIDEO', 'ONLINE_PAYMENTS', 'VIDEO'],
            periodMonths: 12,
        })
        // «Сеть»: 16 990 + 35 × 50 over 400 = 18 740 a month.
        const recurring = (18_740 + 990 + 490) * 12
        const annual = Math.round(recurring * 0.15)
        expect(out.quote.tierCode).toBe('network')
        expect(out.quote.lines.map((l) => l.code)).toEqual([
            'tier',
            'module:VIDEO',
            'module:ONLINE_PAYMENTS',
            'setup',
        ])
        expect(out.quote.discounts).toEqual([
            { code: 'annual', title: 'Оплата за год −15%', amount: annual },
        ])
        expect(out.quote.total).toBe(recurring + 4_990 - annual)
        expect(out.renewal).toBe(recurring - annual)
        expect(out.perMonth).toBe(Math.round((recurring - annual) / 12))
    })

    it('refuses a period other than 1 or 12 months', () => {
        expect(() =>
            QuotePublicPricingInputSchema.parse({ activeMembers: 10, periodMonths: 3 }),
        ).toThrow()
    })
})

describe('public pricing handlers', () => {
    it('serves the running billing config', async () => {
        const out = await new GetPublicPricingHandler().execute()
        expect(out).toEqual(
            publicPricingView(
                environment.billing.pricing,
                environment.billing.trialDays,
            ),
        )
    })

    it('quotes with the running billing config', async () => {
        const payload = QuotePublicPricingInputSchema.parse({
            activeMembers: 120,
            modules: ['BRANDED_APP'],
            periodMonths: 1,
        })
        const out = await new QuotePublicPricingHandler().execute(
            new QuotePublicPricingFeature(payload),
        )
        expect(out).toEqual(
            quotePublicPricing(environment.billing.pricing, payload, new Date()),
        )
    })
})
