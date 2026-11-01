import {
    buildClubImportTemplate,
    CLUB_IMPORT_TEMPLATE_HEADERS,
    normalizeHeader,
    suggestMapping,
} from './club-import-fields'
import { parseClubCsv } from './club-import-csv'

describe('suggestMapping', () => {
    it('recognises the template headers', () => {
        expect(suggestMapping(CLUB_IMPORT_TEMPLATE_HEADERS)).toEqual({
            fullName: 0,
            email: 1,
            phone: 2,
            dateOfBirth: 3,
            parentEmail: 4,
            gym: 5,
            direction: 6,
            group: 7,
            rank: 8,
            stripes: 9,
            plan: 10,
            startDate: 11,
            endDate: 12,
            classesLeft: 13,
            paid: 14,
            notes: 15,
        })
    })

    it('matches English and loosely written headers, one column per field', () => {
        expect(
            suggestMapping(['First name', 'Surname', 'Email', 'Телефон родителя', 'Пояс (кю)', 'Комментарий тренера']),
        ).toEqual({ firstname: 0, lastname: 1, email: 2, parentEmail: 3, rank: 4, notes: 5 })
    })

    it('prefers separate name columns over a ФИО column', () => {
        expect(suggestMapping(['ФИО', 'Имя', 'Фамилия'])).toEqual({ firstname: 1, lastname: 2 })
    })

    it('normalises case, «ё» and punctuation', () => {
        expect(normalizeHeader('  E-Mail  Родителя! ')).toBe('e mail родителя')
        expect(normalizeHeader('Ёлка')).toBe('елка')
    })
})

describe('buildClubImportTemplate', () => {
    it('is a «;» CSV the importer reads back with every column mapped', () => {
        const parsed = parseClubCsv(Buffer.from(buildClubImportTemplate(), 'utf8'))
        expect(parsed.delimiter).toBe(';')
        expect(parsed.headers).toEqual(CLUB_IMPORT_TEMPLATE_HEADERS)
        expect(parsed.rows).toHaveLength(2)
        expect(Object.keys(suggestMapping(parsed.headers))).toHaveLength(16)
    })
})
