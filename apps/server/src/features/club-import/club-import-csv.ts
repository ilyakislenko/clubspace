import { BadRequestError } from '../../shared/errors/shared.errors'

// «Импорт клуба» reads what a spreadsheet saves as CSV: Excel in a Russian
// locale writes «;»-separated Windows-1251 («CSV (разделители — запятые)»)
// or UTF-8 with a BOM («CSV UTF-8»), Google Sheets/LibreOffice write «,»
// UTF-8, «Текст Юникод» is tab-separated UTF-16. No dependency: Node's
// TextDecoder (full ICU) knows windows-1251.

export const CLUB_IMPORT_MAX_BYTES = 2 * 1024 * 1024
export const CLUB_IMPORT_MAX_ROWS = 5000
export const CLUB_IMPORT_MAX_COLUMNS = 60
const MAX_CELL_LENGTH = 2000

export type DecodedCsv = { text: string; encoding: 'utf-8' | 'windows-1251' | 'utf-16le' }

export const decodeCsvBytes = (bytes: Uint8Array): DecodedCsv => {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) {
        return {
            text: new TextDecoder('utf-16le').decode(bytes.subarray(2)),
            encoding: 'utf-16le',
        }
    }
    const body =
        bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
            ? bytes.subarray(3)
            : bytes
    try {
        // fatal: invalid UTF-8 (a 1251 Cyrillic byte on its own) throws
        // instead of turning into U+FFFD, which is how 1251 is told apart.
        return {
            text: new TextDecoder('utf-8', { fatal: true }).decode(body),
            encoding: 'utf-8',
        }
    } catch {
        return {
            text: new TextDecoder('windows-1251').decode(body),
            encoding: 'windows-1251',
        }
    }
}

export type CsvDelimiter = ';' | ',' | '\t'

// The separator is whichever of «;», tab, «,» occurs most often outside quotes
// in the header line; a tie prefers «;» (a Russian Excel file whose header
// also has commas inside names), then tab.
export const detectDelimiter = (text: string): CsvDelimiter => {
    const counts: Record<CsvDelimiter, number> = { ';': 0, '\t': 0, ',': 0 }
    let quoted = false
    for (const ch of text) {
        if (ch === '"') quoted = !quoted
        else if (!quoted && (ch === '\n' || ch === '\r')) {
            if (counts[';'] + counts['\t'] + counts[','] > 0) break
        } else if (!quoted && ch in counts) counts[ch as CsvDelimiter]++
    }
    const order: CsvDelimiter[] = [';', '\t', ',']
    return order.reduce((best, d) => (counts[d] > counts[best] ? d : best), ';')
}

// Our own CSV export prefixes a formula-looking value with «'» (see
// shared/utils/csv.ts); reading it back drops that marker.
const unescapeCell = (cell: string): string => {
    const trimmed = cell.trim()
    return /^'[=+\-@]/.test(trimmed) ? trimmed.slice(1) : trimmed
}

// RFC 4180: quoted fields may hold the separator, doubled quotes and line
// breaks; CRLF, LF and bare CR all end a record. Blank lines are dropped.
export const parseCsv = (text: string, delimiter: CsvDelimiter): string[][] => {
    const rows: string[][] = []
    let row: string[] = []
    let cell = ''
    let quoted = false
    let i = 0
    const pushRow = () => {
        row.push(cell)
        cell = ''
        if (row.some((c) => c.trim() !== '')) rows.push(row.map(unescapeCell))
        row = []
    }
    while (i < text.length) {
        const ch = text[i]
        if (quoted) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    cell += '"'
                    i += 2
                    continue
                }
                quoted = false
            } else {
                cell += ch
            }
            i++
            continue
        }
        if (ch === '"' && cell.trim() === '') {
            cell = ''
            quoted = true
        } else if (ch === delimiter) {
            row.push(cell)
            cell = ''
        } else if (ch === '\r' || ch === '\n') {
            pushRow()
            if (ch === '\r' && text[i + 1] === '\n') i++
        } else {
            cell += ch
        }
        i++
    }
    if (cell !== '' || row.length > 0) pushRow()
    return rows
}

export type ParsedClubCsv = {
    encoding: DecodedCsv['encoding']
    delimiter: CsvDelimiter
    headers: string[]
    rows: string[][]
}

// Bytes → header + data rows, with the limits the wizard explains. Every row
// is padded/cut to the header width so a column index is always valid.
export const parseClubCsv = (bytes: Uint8Array): ParsedClubCsv => {
    if (bytes.length === 0) {
        throw new BadRequestError({ message: 'Файл пустой' })
    }
    if (bytes.length > CLUB_IMPORT_MAX_BYTES) {
        throw new BadRequestError({
            message: `Файл больше ${CLUB_IMPORT_MAX_BYTES / 1024 / 1024} МБ — разделите его на несколько частей`,
        })
    }
    const { text, encoding } = decodeCsvBytes(bytes)
    if (text.includes('\u0000')) {
        throw new BadRequestError({
            message:
                'Это не CSV. Сохраните таблицу в Excel как «CSV (разделители — запятые)» или «CSV UTF-8»',
        })
    }
    const delimiter = detectDelimiter(text)
    const all = parseCsv(text, delimiter)
    if (all.length < 2) {
        throw new BadRequestError({
            message:
                'В файле нет данных: первая строка — заголовки колонок, дальше по строке на ученика',
        })
    }
    const headers = all[0].map((h, i) => h || `Колонка ${i + 1}`)
    if (headers.length > CLUB_IMPORT_MAX_COLUMNS) {
        throw new BadRequestError({
            message: `Слишком много колонок (${headers.length}, максимум ${CLUB_IMPORT_MAX_COLUMNS}) — проверьте разделитель`,
        })
    }
    const rows = all.slice(1)
    if (rows.length > CLUB_IMPORT_MAX_ROWS) {
        throw new BadRequestError({
            message: `В файле ${rows.length} строк, за раз можно загрузить до ${CLUB_IMPORT_MAX_ROWS} — разделите файл на части`,
        })
    }
    return {
        encoding,
        delimiter,
        headers,
        rows: rows.map((r) =>
            headers.map((_, i) => (r[i] ?? '').slice(0, MAX_CELL_LENGTH)),
        ),
    }
}
