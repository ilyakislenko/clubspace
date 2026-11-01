import { parseRuDate, parseYesNo, readRecord, splitFullName } from './club-import-record'

const NOW = new Date('2026-11-01T10:00:00Z')

describe('parseRuDate', () => {
    it.each([
        ['15.04.1990', '1990-04-15'],
        ['5.4.1990', '1990-04-05'],
        ['15/04/1990', '1990-04-15'],
        ['15-04-1990', '1990-04-15'],
        ['1990-04-15', '1990-04-15'],
        ['15.04.1990 0:00', '1990-04-15'],
        ['03.09.16', '2016-09-03'],
        ['03.09.85', '1985-09-03'],
    ])('%s → %s', (raw, ymd) => {
        expect(parseRuDate(raw, NOW)).toBe(ymd)
    })

    it.each(['31.02.2020', '2020-13-01', 'вчера', '15.04', '01.01.1800'])('%s is not a date', (raw) => {
        expect(parseRuDate(raw, NOW)).toBeNull()
    })
})

describe('parseYesNo', () => {
    it('reads Russian and English answers', () => {
        expect(['да', 'Да', 'yes', '1', '+', 'оплачено'].map(parseYesNo)).toEqual(Array(6).fill(true))
        expect(['нет', 'no', '0', '-', 'не оплачено'].map(parseYesNo)).toEqual(Array(5).fill(false))
        expect(parseYesNo('может быть')).toBeNull()
    })
})

describe('splitFullName', () => {
    it('reads ФИО as «Фамилия Имя Отчество»', () => {
        expect(splitFullName('Иванов Иван Иванович')).toEqual({ lastname: 'Иванов', firstname: 'Иван' })
        expect(splitFullName('Иван')).toEqual({ firstname: 'Иван', lastname: null })
        expect(splitFullName('  ')).toEqual({ firstname: null, lastname: null })
    })
})

describe('readRecord', () => {
    const mapping = {
        fullName: 0,
        email: 1,
        phone: 2,
        dateOfBirth: 3,
        stripes: 4,
        plan: 5,
        startDate: 6,
        endDate: 7,
        classesLeft: 8,
        paid: 9,
        notes: 10,
        parentEmail: 11,
        rank: 12,
    }

    it('turns a row into typed values', () => {
        const { record, errors, warnings } = readRecord(
            ['Иванов  Иван', 'Ivan@Mail.RU', '8 (900) 111-22-33', '15.04.1990', '2', '12 занятий', '01.11.2026', '30.11.2026', '7', 'да', ' травма ', '', 'Синий'],
            mapping,
            NOW,
        )
        expect(errors).toEqual([])
        expect(warnings).toEqual([])
        expect(record).toMatchObject({
            firstname: 'Иван',
            lastname: 'Иванов',
            email: 'ivan@mail.ru',
            phone: '+79001112233',
            dateOfBirth: '1990-04-15',
            stripes: 2,
            plan: '12 занятий',
            startDate: '2026-11-01',
            endDate: '2026-11-30',
            classesLeft: 7,
            paid: true,
            notes: 'травма',
            rank: 'Синий',
            parentEmail: null,
        })
    })

    it('collects every problem of a row', () => {
        const { errors } = readRecord(
            ['Иван', 'not-an-email', '', '01.01.2030', 'много', '', '10.11.2026', '01.11.2026', '-1', 'наверное', '', 'mama@', ''],
            mapping,
            NOW,
        )
        expect(errors).toEqual([
            'E-mail: «not-an-email» — не похоже на e-mail',
            'E-mail родителя: «mama@» — не похоже на e-mail',
            'Дата рождения в будущем',
            'Дата окончания абонемента должна быть позже даты начала',
            'Полоски: «много» — нужно целое число от 0 до 20',
            'Осталось занятий: «-1» — нужно целое число от 0 до 1000',
            'Оплачено: «наверное» — напишите «да» или «нет»',
        ])
    })

    it('warns about parts it drops and refuses a row with neither name nor e-mail', () => {
        const res = readRecord(['Иван', '', '12345', '', '3', '', '01.11.2026', '', '', '', '', '', ''], mapping, NOW)
        expect(res.errors).toEqual([])
        expect(res.warnings).toEqual([
            expect.stringContaining('Телефон «12345» не сохранён'),
            'Полоски без пояса не сохранены',
            'Даты, остаток и оплата без абонемента не сохранены',
        ])
        expect(readRecord(Array(13).fill(''), mapping, NOW).errors).toEqual(['Нет ни имени, ни e-mail'])
    })

    it('uses separate name columns when mapped', () => {
        const { record } = readRecord(['Петров', 'Пётр'], { lastname: 0, firstname: 1 }, NOW)
        expect(record).toMatchObject({ firstname: 'Пётр', lastname: 'Петров' })
    })
})
