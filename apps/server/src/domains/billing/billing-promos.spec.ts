import { activePromos } from './billing-promos'

const now = new Date('2026-11-10T12:00:00.000Z')
const later = new Date('2027-01-10T12:00:00.000Z')
const earlier = new Date('2026-11-01T12:00:00.000Z')
const names = () => 'Видео'

const row = (over: Record<string, unknown> = {}) => ({
    freeUntil: null,
    discountPercent: 0,
    discountUntil: null,
    setupFeeWaived: false,
    setupFeePaidAt: null,
    ...over,
})

describe('activePromos', () => {
    it('is empty for a club without overrides', () => {
        expect(activePromos(row(), [], names, now)).toEqual([])
    })

    it('lists every running promo with its end date', () => {
        expect(
            activePromos(
                row({
                    freeUntil: later,
                    discountPercent: 20,
                    discountUntil: later,
                    setupFeeWaived: true,
                }),
                [{ module: 'VIDEO', mode: 'COMP', compUntil: later }],
                names,
                now,
            ),
        ).toEqual([
            { kind: 'FREE_PERIOD', title: 'Подписка бесплатно', until: later },
            { kind: 'DISCOUNT', title: 'Скидка 20% на подписку и модули', until: later },
            { kind: 'MODULE_GIFT', title: 'Модуль «Видео» в подарок', until: later },
            { kind: 'SETUP_FEE_WAIVED', title: 'Подключение без оплаты', until: null },
        ])
    })

    it('drops what has ended or been used', () => {
        expect(
            activePromos(
                row({
                    freeUntil: earlier,
                    discountPercent: 20,
                    discountUntil: earlier,
                    setupFeeWaived: true,
                    setupFeePaidAt: earlier,
                }),
                [
                    { module: 'VIDEO', mode: 'COMP', compUntil: earlier },
                    { module: 'ONLINE_PAYMENTS', mode: 'PAID', compUntil: null },
                ],
                names,
                now,
            ),
        ).toEqual([])
    })

    it('a discount without an end runs until lifted', () => {
        expect(activePromos(row({ discountPercent: 5 }), [], names, now)).toEqual([
            { kind: 'DISCOUNT', title: 'Скидка 5% на подписку и модули', until: null },
        ])
    })
})
