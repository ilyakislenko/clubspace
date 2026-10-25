import { pluralRu } from './plural-ru'

describe('pluralRu', () => {
    const f = (n: number) => pluralRu(n, 'день', 'дня', 'дней')

    it('uses the one form for 1, 21, 101', () => {
        expect([1, 21, 101].map(f)).toEqual(['день', 'день', 'день'])
    })

    it('uses the few form for 2-4 and 22-24', () => {
        expect([2, 3, 4, 22, 24].map(f)).toEqual([
            'дня',
            'дня',
            'дня',
            'дня',
            'дня',
        ])
    })

    it('uses the many form for 0, 5-20, 11-14 and 25', () => {
        expect([0, 5, 11, 12, 14, 20, 25].map(f)).toEqual(
            Array(7).fill('дней'),
        )
    })
})
