import { cleanPayer, normalizeCurrency, parseStatementAmount, parseStatementDate } from './statement-values'

describe('parseStatementAmount', () => {
    it.each([
        ['3000', 300000],
        ['3 000,00', 300000],
        ['3\u00a0000,50', 300050],
        ['-450,50', -45050],
        ['+1 234,56 ₽', 123456],
        ['1,234.56', 123456],
        ['1.234,5', 123450],
        ['2500.00', 250000],
        ['−100', -10000],
    ])('«%s» → %d kopecks', (raw, minor) => {
        expect(parseStatementAmount(raw)).toBe(minor)
    })

    it.each(['', 'abc', '12,345,67x', '1.2.3'])('«%s» is not an amount', (raw) => {
        expect(parseStatementAmount(raw)).toBeNull()
    })
})

describe('parseStatementDate', () => {
    it.each([
        ['28.11.2026', { date: '2026-11-28', time: null }],
        ['28.11.2026 14:03:11', { date: '2026-11-28', time: '14:03' }],
        ['1.2.26', { date: '2026-02-01', time: null }],
        ['2026-11-28T09:05:00Z', { date: '2026-11-28', time: '09:05' }],
        ['28.11.2026 00:00:00', { date: '2026-11-28', time: null }],
    ])('«%s»', (raw, expected) => {
        expect(parseStatementDate(raw)).toEqual(expected)
    })

    it.each(['Итого', '31.02.2026', '', '28/13/2026'])('«%s» is not a date', (raw) => {
        expect(parseStatementDate(raw)).toBeNull()
    })
})

describe('normalizeCurrency / cleanPayer', () => {
    it('reads rouble spellings as RUB', () => {
        expect(['', 'RUR', 'руб.', '₽', '643', 'rub'].map(normalizeCurrency)).toEqual([
            'RUB',
            'RUB',
            'RUB',
            'RUB',
            'RUB',
            'RUB',
        ])
        expect(normalizeCurrency('usd')).toBe('USD')
    })

    it('cuts ИНН, КПП, accounts and the address tail off the payer', () => {
        expect(cleanPayer('ИНН 701712345678 ПЕТРОВА ЕЛЕНА СЕРГЕЕВНА')).toBe('ПЕТРОВА ЕЛЕНА СЕРГЕЕВНА')
        expect(cleanPayer('ООО «Ромашка» ИНН 7017111111 КПП 701701001')).toBe('ООО «Ромашка»')
        expect(cleanPayer('Иванов Иван Иванович//г. Томск, ул. Ленина 1//')).toBe('Иванов Иван Иванович')
        expect(cleanPayer('Смирнов П. р/с 40817810000000000001')).toBe('Смирнов П.')
    })
})
