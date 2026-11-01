import {
    CLUB_IMPORT_MAX_ROWS,
    decodeCsvBytes,
    detectDelimiter,
    parseClubCsv,
    parseCsv,
} from './club-import-csv'

// «Привет» in Windows-1251.
const CP1251_PRIVET = [0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]

describe('decodeCsvBytes', () => {
    it('reads UTF-8 and strips the BOM Excel adds to «CSV UTF-8»', () => {
        const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Имя', 'utf8')])
        expect(decodeCsvBytes(bytes)).toEqual({ text: 'Имя', encoding: 'utf-8' })
    })

    it('falls back to Windows-1251 when the bytes are not valid UTF-8', () => {
        expect(decodeCsvBytes(Buffer.from(CP1251_PRIVET))).toEqual({
            text: 'Привет',
            encoding: 'windows-1251',
        })
    })

    it('reads UTF-16LE «Текст Юникод» by its BOM', () => {
        const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Да', 'utf16le')])
        expect(decodeCsvBytes(bytes)).toEqual({ text: 'Да', encoding: 'utf-16le' })
    })
})

describe('detectDelimiter', () => {
    it('picks the most frequent separator of the header line', () => {
        expect(detectDelimiter('a;b;c\n1,2;3')).toBe(';')
        expect(detectDelimiter('a,b,c\n1;2')).toBe(',')
        expect(detectDelimiter('a\tb\tc')).toBe('\t')
    })

    it('ignores separators inside quotes and prefers «;» on a tie', () => {
        expect(detectDelimiter('"Иванов, Иван, Иванович";b\n')).toBe(';')
        expect(detectDelimiter('a\n')).toBe(';')
        expect(detectDelimiter('"x;y;z",a,b')).toBe(',')
    })
})

describe('parseCsv', () => {
    it('handles quotes, doubled quotes, line breaks in cells and blank lines', () => {
        const text = 'a;b\r\n"x; y";"he said ""hi"""\n\n"multi\nline";2\r3;4'
        expect(parseCsv(text, ';')).toEqual([
            ['a', 'b'],
            ['x; y', 'he said "hi"'],
            ['multi\nline', '2'],
            ['3', '4'],
        ])
    })

    it("drops the «'» our own export puts before formula-looking values", () => {
        expect(parseCsv("'+79001112233,'=x,'plain", ',')).toEqual([
            ['+79001112233', '=x', "'plain"],
        ])
    })
})

describe('parseClubCsv', () => {
    it('pads short rows to the header width and names blank headers', () => {
        const parsed = parseClubCsv(Buffer.from('ФИО,,E-mail\nИван\n'))
        expect(parsed).toEqual({
            encoding: 'utf-8',
            delimiter: ',',
            headers: ['ФИО', 'Колонка 2', 'E-mail'],
            rows: [['Иван', '', '']],
        })
    })

    it('refuses empty, header-only, binary, too wide and too long files', () => {
        expect(() => parseClubCsv(Buffer.alloc(0))).toThrow('Файл пустой')
        expect(() => parseClubCsv(Buffer.from('ФИО'))).toThrow('нет данных')
        expect(() => parseClubCsv(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).toThrow(
            'Это не CSV',
        )
        const wide = Array.from({ length: 61 }, (_, i) => `c${i}`).join(',')
        expect(() => parseClubCsv(Buffer.from(`${wide}\n1`))).toThrow('Слишком много колонок')
        const long = ['a', ...Array.from({ length: CLUB_IMPORT_MAX_ROWS + 1 }, () => 'x')].join('\n')
        expect(() => parseClubCsv(Buffer.from(long))).toThrow('до 5000')
        expect(() => parseClubCsv(Buffer.alloc(2 * 1024 * 1024 + 1, 0x61))).toThrow('больше 2 МБ')
    })
})
